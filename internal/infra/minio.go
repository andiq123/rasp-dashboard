package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	minioContainer = "firewifi-minio"
	minioAPIAddr   = "127.0.0.1:9000"
	minioEndpoint  = "http://127.0.0.1:9000"
	defaultMinioUser = "firewifi"
)

var bucketNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

// MinIO is the shared S3-compatible object storage engine (compose service "minio").
type MinIO struct {
	ComposeFile string
	EnvFile     string
	statusMu   sync.Mutex
	statusAt   time.Time
	statusSnap MinIOStatus
	usageMu    sync.Mutex
	usageCache map[string]bucketUsageSnap
}

type bucketUsageSnap struct {
	at        time.Time
	sizeBytes int64
	human     string
}

func NewMinIO(baseDir string) *MinIO {
	compose := filepath.Join(baseDir, "infra", "docker-compose.yml")
	return &MinIO{
		ComposeFile: compose,
		EnvFile:     filepath.Join(filepath.Dir(compose), ".env"),
	}
}

type MinIOStatus struct {
	Running  bool   `json:"running"`
	Endpoint string `json:"endpoint"`
	Image    string `json:"image,omitempty"`
	Detail   string `json:"detail,omitempty"`
}

type BucketInfo struct {
	Name      string `json:"name"`
	Endpoint  string `json:"endpoint"`
	AccessKey string `json:"access_key"`
	SecretKey string `json:"secret_key"`
	Region    string `json:"region"`
}

func (m *MinIO) Status(ctx context.Context) MinIOStatus {
	m.statusMu.Lock()
	if time.Since(m.statusAt) < 2*time.Second {
		st := m.statusSnap
		m.statusMu.Unlock()
		return st
	}
	m.statusMu.Unlock()
	st := m.statusSlow(ctx)
	m.statusMu.Lock()
	m.statusSnap = st
	m.statusAt = time.Now()
	m.statusMu.Unlock()
	return st
}

func (m *MinIO) statusSlow(ctx context.Context) MinIOStatus {
	st := MinIOStatus{Endpoint: minioEndpoint, Image: m.Image()}
	if _, err := exec.LookPath("docker"); err != nil {
		st.Detail = "docker not installed"
		return st
	}
	state := m.containerState(ctx)
	if state == "" || state == "missing" {
		st.Detail = "stopped"
		return st
	}
	if state != "running" {
		st.Detail = "container " + state
		return st
	}
	if !m.portOpen() {
		st.Detail = "container up, port not ready"
		return st
	}
	st.Running = true
	st.Detail = "listening on " + minioAPIAddr
	return st
}

func (m *MinIO) portOpen() bool {
	conn, err := net.DialTimeout("tcp", minioAPIAddr, 800*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func (m *MinIO) containerState(ctx context.Context) string {
	out, err := m.compose(ctx, "ps", "-a", "--format", "{{.State}}", "minio").CombinedOutput()
	if err != nil {
		return ""
	}
	s := strings.ToLower(strings.TrimSpace(string(out)))
	if s == "" {
		return "missing"
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func (m *MinIO) Start(ctx context.Context) error {
	if _, err := exec.LookPath("docker"); err != nil {
		return fmt.Errorf("docker not installed — run ~/vpn-hotspot/bin/setup-infra")
	}
	if err := m.ensureRootCreds(); err != nil {
		return err
	}
	out, err := m.compose(ctx, "up", "-d", "minio").CombinedOutput()
	if err != nil {
		return fmt.Errorf("minio start: %s", strings.TrimSpace(string(out)))
	}
	return m.WaitHealthy(ctx, 90*time.Second)
}

func (m *MinIO) Stop(ctx context.Context) error {
	out, err := m.compose(ctx, "stop", "minio").CombinedOutput()
	if err != nil {
		return fmt.Errorf("minio stop: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func (m *MinIO) Restart(ctx context.Context) error {
	if err := m.Stop(ctx); err != nil {
		return err
	}
	return m.Start(ctx)
}

func (m *MinIO) WaitHealthy(ctx context.Context, timeout time.Duration) error {
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	deadline := time.Now().Add(timeout)
	var last string
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		st := m.Status(ctx)
		last = st.Detail
		if st.Running {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(750 * time.Millisecond):
		}
	}
	return fmt.Errorf("minio not ready after waiting (%s)", last)
}

// CreateBucket ensures the engine is up and creates an S3 bucket (idempotent).
func (m *MinIO) CreateBucket(ctx context.Context, name string) (BucketInfo, error) {
	name = sanitizeBucketName(name)
	if name == "" {
		return BucketInfo{}, fmt.Errorf("invalid bucket name")
	}
	user, pass, err := m.RootCreds()
	if err != nil {
		return BucketInfo{}, err
	}
	if err := m.Start(ctx); err != nil {
		return BucketInfo{}, err
	}
	if err := m.WaitHealthy(ctx, 30*time.Second); err != nil {
		return BucketInfo{}, err
	}
	if err := m.mc(ctx, user, pass, "mb", "--ignore-existing", "local/"+name); err != nil {
		return BucketInfo{}, err
	}
	return BucketInfo{
		Name:      name,
		Endpoint:  minioEndpoint,
		AccessKey: user,
		SecretKey: pass,
		Region:    "us-east-1",
	}, nil
}

// DeleteBucket removes a bucket and its objects (best-effort if engine is down).
func (m *MinIO) DeleteBucket(ctx context.Context, name string) error {
	name = sanitizeBucketName(name)
	if name == "" {
		return nil
	}
	if !m.Status(ctx).Running {
		return nil
	}
	user, pass, err := m.RootCreds()
	if err != nil {
		return err
	}
	_ = m.mc(ctx, user, pass, "rb", "--force", "local/"+name)
	return nil
}

// BucketUsage returns object-storage usage for one bucket via `mc du --json`.
// Results are cached briefly per bucket name. On stop/missing/empty, returns 0, "".
func (m *MinIO) BucketUsage(ctx context.Context, name string) (sizeBytes int64, human string) {
	name = sanitizeBucketName(name)
	if name == "" || m == nil {
		return 0, ""
	}
	m.usageMu.Lock()
	if m.usageCache != nil {
		if snap, ok := m.usageCache[name]; ok && time.Since(snap.at) < 30*time.Second {
			m.usageMu.Unlock()
			return snap.sizeBytes, snap.human
		}
	}
	m.usageMu.Unlock()

	sizeBytes, human = m.bucketUsageSlow(ctx, name)

	m.usageMu.Lock()
	if m.usageCache == nil {
		m.usageCache = map[string]bucketUsageSnap{}
	}
	m.usageCache[name] = bucketUsageSnap{at: time.Now(), sizeBytes: sizeBytes, human: human}
	m.usageMu.Unlock()
	return sizeBytes, human
}

func (m *MinIO) bucketUsageSlow(ctx context.Context, name string) (int64, string) {
	if !m.Status(ctx).Running {
		return 0, ""
	}
	user, pass, err := m.RootCreds()
	if err != nil {
		return 0, ""
	}
	out, err := m.mcOut(ctx, user, pass, "du", "--json", "local/"+name)
	if err != nil {
		return 0, ""
	}
	n, ok := parseMcDuJSON(out)
	if !ok || n <= 0 {
		return 0, ""
	}
	return n, formatBytes(n)
}

// parseMcDuJSON extracts total size from `mc du --json` output.
// Success lines look like: {"prefix":"b","size":123,"objects":1,"status":"success"}
func parseMcDuJSON(raw []byte) (int64, bool) {
	var total int64
	found := false
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var row struct {
			Size   int64  `json:"size"`
			Status string `json:"status"`
		}
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			continue
		}
		if row.Status != "" && row.Status != "success" {
			continue
		}
		total += row.Size
		found = true
	}
	return total, found
}

func (m *MinIO) Image() string {
	out, err := exec.Command("sudo", "-n", "docker", "inspect", "-f", "{{.Config.Image}}", minioContainer).CombinedOutput()
	if err != nil {
		return "minio/minio"
	}
	s := strings.TrimSpace(string(out))
	if s == "" {
		return "minio/minio"
	}
	return s
}

func (m *MinIO) RootCreds() (user, pass string, err error) {
	if err := m.ensureRootCreds(); err != nil {
		return "", "", err
	}
	env, err := readDotEnv(m.EnvFile)
	if err != nil {
		return "", "", err
	}
	user = strings.TrimSpace(env["MINIO_ROOT_USER"])
	pass = strings.TrimSpace(env["MINIO_ROOT_PASSWORD"])
	if user == "" {
		user = defaultMinioUser
	}
	if pass == "" {
		return "", "", fmt.Errorf("MINIO_ROOT_PASSWORD missing")
	}
	return user, pass, nil
}

func (m *MinIO) ensureRootCreds() error {
	env, err := readDotEnv(m.EnvFile)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if env == nil {
		env = map[string]string{}
	}
	changed := false
	if strings.TrimSpace(env["MINIO_ROOT_USER"]) == "" {
		env["MINIO_ROOT_USER"] = defaultMinioUser
		changed = true
	}
	if strings.TrimSpace(env["MINIO_ROOT_PASSWORD"]) == "" {
		pass, err := randomPass(24)
		if err != nil {
			return err
		}
		env["MINIO_ROOT_PASSWORD"] = pass
		changed = true
	}
	if !changed && fileExists(m.EnvFile) {
		return nil
	}
	return writeDotEnv(m.EnvFile, env)
}

func (m *MinIO) compose(ctx context.Context, args ...string) *exec.Cmd {
	all := append([]string{"-n", "docker", "compose", "-f", m.ComposeFile}, args...)
	return exec.CommandContext(ctx, "sudo", all...)
}

func (m *MinIO) mc(ctx context.Context, user, pass string, args ...string) error {
	_, err := m.mcOut(ctx, user, pass, args...)
	return err
}

func (m *MinIO) mcOut(ctx context.Context, user, pass string, args ...string) ([]byte, error) {
	script := "mc alias set local " + minioEndpoint + " " + shellQuote(user) + " " + shellQuote(pass) + " >/dev/null && mc " + strings.Join(shellQuoteAll(args), " ")
	cmd := exec.CommandContext(ctx, "sudo", "-n", "docker", "run", "--rm", "--network", "host",
		"--entrypoint", "/bin/sh", "minio/mc", "-c", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return out, fmt.Errorf("mc: %s", strings.TrimSpace(string(out)))
	}
	return out, nil
}

func sanitizeBucketName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	name = strings.ReplaceAll(name, "_", "-")
	name = regexp.MustCompile(`[^a-z0-9.-]+`).ReplaceAllString(name, "-")
	name = strings.Trim(name, "-.")
	if len(name) < 3 {
		return ""
	}
	if len(name) > 63 {
		name = name[:63]
		name = strings.Trim(name, "-.")
	}
	if !bucketNameRe.MatchString(name) {
		return ""
	}
	return name
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

func shellQuoteAll(args []string) []string {
	out := make([]string, len(args))
	for i, a := range args {
		out[i] = shellQuote(a)
	}
	return out
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func readDotEnv(path string) (map[string]string, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		out[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return out, nil
}

func writeDotEnv(path string, env map[string]string) error {
	// Preserve unknown keys; upsert MinIO + keep POSTGRES_IMAGE if present.
	existing, _ := readDotEnv(path)
	if existing == nil {
		existing = map[string]string{}
	}
	for k, v := range env {
		existing[k] = v
	}
	keys := []string{"POSTGRES_IMAGE", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD"}
	seen := map[string]bool{}
	var b strings.Builder
	for _, k := range keys {
		if v, ok := existing[k]; ok && v != "" {
			fmt.Fprintf(&b, "%s=%s\n", k, v)
			seen[k] = true
		}
	}
	for k, v := range existing {
		if seen[k] || v == "" {
			continue
		}
		fmt.Fprintf(&b, "%s=%s\n", k, v)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(b.String()), 0o600)
}
