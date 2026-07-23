package infra

import (
	"context"
	"crypto/rand"
	"encoding/hex"
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
	DefaultDSN = "postgres://firewifi:firewifi@127.0.0.1:5432/firewifi?sslmode=disable"
	adminUser  = "firewifi"
	adminPass  = "firewifi"
	adminDB    = "firewifi"
)

var identRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

type Postgres struct {
	ComposeFile string
	statusMu   sync.Mutex
	statusAt   time.Time
	statusSnap Status
	volMu      sync.Mutex
	volAt      time.Time
	volSnap    VolumeInfo
}

func NewPostgres(baseDir string) *Postgres {
	return &Postgres{ComposeFile: filepath.Join(baseDir, "infra", "docker-compose.yml")}
}

type Status struct {
	Running bool   `json:"running"`
	DSN     string `json:"dsn"`
	Image   string `json:"image,omitempty"`
	Detail  string `json:"detail,omitempty"`
}

func (p *Postgres) Status(ctx context.Context) Status {
	p.statusMu.Lock()
	if time.Since(p.statusAt) < 2*time.Second {
		st := p.statusSnap
		p.statusMu.Unlock()
		return st
	}
	p.statusMu.Unlock()

	st := p.statusSlow(ctx)

	p.statusMu.Lock()
	p.statusSnap = st
	p.statusAt = time.Now()
	p.statusMu.Unlock()
	return st
}

func (p *Postgres) statusSlow(ctx context.Context) Status {
	st := Status{DSN: DefaultDSN, Image: p.Image()}
	if _, err := exec.LookPath("docker"); err != nil {
		st.Detail = "docker not installed — run bin/setup-infra"
		return st
	}
	state := p.containerState(ctx)
	if state == "" || state == "missing" {
		st.Detail = "stopped"
		return st
	}
	if state == "restarting" || state == "exited" || state == "dead" || state == "created" {
		st.Detail = "container " + state
		return st
	}
	if state != "running" {
		st.Detail = "container " + state
		return st
	}
	if !p.portOpen() {
		st.Detail = "container up, port not ready"
		return st
	}
	if !p.pgReady(ctx) {
		st.Detail = "container up, postgres not ready"
		return st
	}
	st.Running = true
	st.Detail = "listening on 127.0.0.1:5432"
	return st
}

func (p *Postgres) portOpen() bool {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:5432", 800*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// containerState returns docker state for the compose postgres service (running, restarting, …).
func (p *Postgres) containerState(ctx context.Context) string {
	out, err := p.compose(ctx, "ps", "-a", "--format", "{{.State}}", "postgres").CombinedOutput()
	if err != nil {
		return ""
	}
	s := strings.ToLower(strings.TrimSpace(string(out)))
	if s == "" {
		return "missing"
	}
	// First line only (compose may print headers on older versions).
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func (p *Postgres) pgReady(ctx context.Context) bool {
	cmd := p.compose(ctx, "exec", "-T", "postgres", "pg_isready", "-U", adminUser, "-d", adminDB)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), "accepting connections")
}

func (p *Postgres) Start(ctx context.Context) error {
	if _, err := exec.LookPath("docker"); err != nil {
		return fmt.Errorf("docker not installed — run ~/vpn-hotspot/bin/setup-infra")
	}
	out, err := p.compose(ctx, "up", "-d", "postgres").CombinedOutput()
	if err != nil {
		return fmt.Errorf("postgres start: %s", strings.TrimSpace(string(out)))
	}
	return p.WaitHealthy(ctx, 90*time.Second)
}

// WaitHealthy blocks until Postgres accepts connections, or returns a clear error
// if the container is crash-looping (e.g. incompatible major upgrade / volume).
func (p *Postgres) WaitHealthy(ctx context.Context, timeout time.Duration) error {
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	deadline := time.Now().Add(timeout)
	var lastDetail string
	restartHits := 0
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		st := p.Status(ctx)
		lastDetail = st.Detail
		if st.Running {
			return nil
		}
		state := p.containerState(ctx)
		if state == "restarting" || state == "exited" || state == "dead" {
			restartHits++
			if restartHits >= 4 {
				logs := p.tailLogs(ctx, 30)
				hint := "Postgres engine is crash-looping"
				if strings.Contains(logs, "major-version") || strings.Contains(logs, "pg_upgrade") || strings.Contains(logs, "18+") {
					hint = "Postgres image is incompatible with the existing data volume — pick Postgres 16 (or run pg_upgrade)"
				}
				if strings.TrimSpace(logs) != "" {
					return fmt.Errorf("%s\n%s", hint, trimLogTail(logs, 600))
				}
				return fmt.Errorf("%s (%s)", hint, lastDetail)
			}
		} else {
			restartHits = 0
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(750 * time.Millisecond):
		}
	}
	return fmt.Errorf("postgres not ready after waiting (%s)", lastDetail)
}

func (p *Postgres) tailLogs(ctx context.Context, n int) string {
	if n <= 0 {
		n = 30
	}
	out, err := p.compose(ctx, "logs", "--no-color", "--tail", fmt.Sprintf("%d", n), "postgres").CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func trimLogTail(s string, max int) string {
	s = strings.TrimSpace(s)
	if max > 0 && len(s) > max {
		return "…" + s[len(s)-max:]
	}
	return s
}

func (p *Postgres) Stop(ctx context.Context) error {
	out, err := p.compose(ctx, "stop", "postgres").CombinedOutput()
	if err != nil {
		return fmt.Errorf("postgres stop: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

type Database struct {
	Name     string
	User     string
	Password string
	URL      string
}

// CreateDatabase ensures the engine is healthy, then creates an isolated DB + role.
func (p *Postgres) CreateDatabase(ctx context.Context, name string) (Database, error) {
	name = sanitizeIdent(name)
	if name == "" {
		return Database{}, fmt.Errorf("invalid database name")
	}
	if err := p.Start(ctx); err != nil {
		return Database{}, err
	}
	// Start already waited; re-check so we never exec into a restarting container.
	if err := p.WaitHealthy(ctx, 30*time.Second); err != nil {
		return Database{}, err
	}
	user := name + "_user"
	pass, err := randomPass(16)
	if err != nil {
		return Database{}, err
	}
	stmts := []string{
		fmt.Sprintf(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid();`, name),
		fmt.Sprintf(`DROP DATABASE IF EXISTS %s;`, name),
		fmt.Sprintf(`DROP ROLE IF EXISTS %s;`, user),
		fmt.Sprintf(`CREATE ROLE %s LOGIN PASSWORD '%s';`, user, escapeLiteral(pass)),
		fmt.Sprintf(`CREATE DATABASE %s OWNER %s;`, name, user),
		fmt.Sprintf(`GRANT ALL PRIVILEGES ON DATABASE %s TO %s;`, name, user),
	}
	for _, sql := range stmts {
		if err := p.psqlReady(ctx, sql); err != nil {
			if strings.Contains(sql, "pg_terminate_backend") || strings.Contains(sql, "DROP ") {
				continue
			}
			return Database{}, err
		}
	}
	url := fmt.Sprintf("postgres://%s:%s@127.0.0.1:5432/%s?sslmode=disable", user, pass, name)
	return Database{Name: name, User: user, Password: pass, URL: url}, nil
}

func (p *Postgres) DropDatabase(ctx context.Context, name string) error {
	name = sanitizeIdent(name)
	if name == "" {
		return nil
	}
	if !p.Status(ctx).Running {
		return nil
	}
	user := name + "_user"
	_ = p.psql(ctx, fmt.Sprintf(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid();`, name))
	_ = p.psql(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %s;`, name))
	_ = p.psql(ctx, fmt.Sprintf(`DROP ROLE IF EXISTS %s;`, user))
	return nil
}

func (p *Postgres) psql(ctx context.Context, sql string) error {
	cmd := exec.CommandContext(ctx, "sudo", "-n", "docker", "compose", "-f", p.ComposeFile, "exec", "-T", "postgres",
		"psql", "-U", adminUser, "-d", adminDB, "-v", "ON_ERROR_STOP=1", "-c", sql)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("psql: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// psqlReady waits for a healthy engine, then runs psql with short retries.
func (p *Postgres) psqlReady(ctx context.Context, sql string) error {
	if err := p.WaitHealthy(ctx, 45*time.Second); err != nil {
		return err
	}
	var last error
	for attempt := 0; attempt < 8; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		state := p.containerState(ctx)
		if state == "restarting" || state == "exited" || state == "dead" {
			last = fmt.Errorf("postgres container is %s — wait for engine to stabilize", state)
			time.Sleep(time.Duration(attempt+1) * 500 * time.Millisecond)
			continue
		}
		err := p.psql(ctx, sql)
		if err == nil {
			return nil
		}
		last = err
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "is restarting") || strings.Contains(msg, "not running") || strings.Contains(msg, "connection refused") {
			time.Sleep(time.Duration(attempt+1) * 500 * time.Millisecond)
			_ = p.WaitHealthy(ctx, 20*time.Second)
			continue
		}
		return err
	}
	if last == nil {
		last = fmt.Errorf("psql failed after retries")
	}
	return last
}

func (p *Postgres) compose(ctx context.Context, args ...string) *exec.Cmd {
	all := append([]string{"-n", "docker", "compose", "-f", p.ComposeFile}, args...)
	return exec.CommandContext(ctx, "sudo", all...)
}

func sanitizeIdent(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "-", "_")
	s = regexp.MustCompile(`[^a-z0-9_]+`).ReplaceAllString(s, "")
	if s != "" && s[0] >= '0' && s[0] <= '9' {
		s = "db_" + s
	}
	if !identRe.MatchString(s) {
		return ""
	}
	return s
}

func escapeLiteral(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func randomPass(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (p *Postgres) EnvFile() string {
	return filepath.Join(filepath.Dir(p.ComposeFile), ".env")
}

// Image returns the configured postgres image (from compose .env or default).
func (p *Postgres) Image() string {
	b, err := os.ReadFile(p.EnvFile())
	if err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "POSTGRES_IMAGE=") {
				v := strings.TrimSpace(strings.TrimPrefix(line, "POSTGRES_IMAGE="))
				v = strings.Trim(v, `"'`)
				if v != "" {
					return v
				}
			}
		}
	}
	return "postgres:16-alpine"
}

// SetImage writes POSTGRES_IMAGE and recreates the engine container.
// Existing data volume is kept — major upgrades may need manual dump/restore.
func (p *Postgres) SetImage(ctx context.Context, image string) error {
	image = strings.TrimSpace(image)
	if image == "" {
		return fmt.Errorf("image required")
	}
	if !strings.HasPrefix(image, "postgres:") {
		return fmt.Errorf("image must be postgres:…")
	}
	dir := filepath.Dir(p.ComposeFile)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	body := "POSTGRES_IMAGE=" + image + "\n"
	if err := os.WriteFile(p.EnvFile(), []byte(body), 0o644); err != nil {
		return err
	}
	out, err := p.compose(ctx, "pull", "postgres").CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("postgres pull %s: %s", image, msg)
	}
	out, err = p.compose(ctx, "up", "-d", "--force-recreate", "postgres").CombinedOutput()
	if err != nil {
		return fmt.Errorf("postgres recreate: %s", strings.TrimSpace(string(out)))
	}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if p.Status(ctx).Running {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return fmt.Errorf("postgres recreated but port 5432 not ready")
}
