package deploy

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	autoDeployInterval = 60 * time.Second
	deployTokenBytes   = 32
)

// ErrUnauthorized is returned when a deploy hook token/signature is invalid.
var ErrUnauthorized = errors.New("unauthorized")

var (
	autoDeployOnce sync.Once
	redeployGate   sync.Mutex
)

func (m *Manager) deployTokenPath() string {
	return filepath.Join(m.DeployDir, "config", "deploy.token")
}

// EnsureDeployToken returns the shared hook token, creating it if missing.
func (m *Manager) EnsureDeployToken() (string, error) {
	path := m.deployTokenPath()
	if b, err := os.ReadFile(path); err == nil {
		if tok := strings.TrimSpace(string(b)); tok != "" {
			return tok, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	raw := make([]byte, deployTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	tok := hex.EncodeToString(raw)
	if err := os.WriteFile(path, []byte(tok+"\n"), 0o600); err != nil {
		return "", err
	}
	return tok, nil
}

func (m *Manager) readDeployToken() (string, error) {
	b, err := os.ReadFile(m.deployTokenPath())
	if err != nil {
		if os.IsNotExist(err) {
			return m.EnsureDeployToken()
		}
		return "", err
	}
	if tok := strings.TrimSpace(string(b)); tok != "" {
		return tok, nil
	}
	return m.EnsureDeployToken()
}

// ValidateDeployToken accepts X-FireWifi-Token or Authorization: Bearer.
func (m *Manager) ValidateDeployToken(r *http.Request) error {
	want, err := m.readDeployToken()
	if err != nil {
		return err
	}
	got := strings.TrimSpace(r.Header.Get("X-FireWifi-Token"))
	if got == "" {
		auth := strings.TrimSpace(r.Header.Get("Authorization"))
		if len(auth) >= 7 && strings.EqualFold(auth[:7], "bearer ") {
			got = strings.TrimSpace(auth[7:])
		}
	}
	if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		return ErrUnauthorized
	}
	return nil
}

// BootstrapAutoDeploy enables defaults and starts the commit watcher.
func (m *Manager) BootstrapAutoDeploy() {
	autoDeployOnce.Do(func() {
		if _, err := m.EnsureDeployToken(); err != nil {
			m.logf("warn", "Auto-deploy token: %v", err)
		}
		m.enableAutoDeployDefaults()
		go m.autoDeployLoop()
	})
}

func (m *Manager) enableAutoDeployDefaults() {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return
	}
	changed := false
	for i := range reg.Services {
		svc := &reg.Services[i]
		if svc.Type != TypeGo || strings.TrimSpace(svc.Repo) == "" {
			continue
		}
		if svc.AutoDeploySet {
			continue
		}
		svc.AutoDeploy = true
		svc.AutoDeploySet = true
		changed = true
	}
	if !changed {
		return
	}
	_ = m.saveRegistry(reg)
	for _, svc := range reg.Services {
		if svc.Type == TypeGo {
			_ = m.writeMeta(svc)
		}
	}
}

func (m *Manager) autoDeployLoop() {
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	for {
		<-timer.C
		m.pollAutoDeploys()
		timer.Reset(autoDeployInterval)
	}
}

func (m *Manager) pollAutoDeploys() {
	token, err := m.readToken()
	if err != nil || token == "" {
		return
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	for _, svc := range reg.Services {
		if !m.shouldPollService(svc) {
			continue
		}
		sha, err := m.githubBranchSHA(ctx, token, normalizeRepo(svc.Repo), strings.TrimSpace(svc.Branch))
		if err != nil || sha == "" {
			continue
		}
		if svc.DeploySHA == "" {
			m.setDeploySHA(svc.Group, svc.Slug, sha)
			continue
		}
		if sameCommit(svc.DeploySHA, sha) {
			continue
		}
		m.logf("info", "Auto-deploy %s/%s · new commit %s", svc.Group, svc.Slug, shortSHA(sha))
		go m.triggerAutoRedeploy(svc.Group, svc.Slug, sha)
	}
}

func (m *Manager) shouldPollService(svc Service) bool {
	if svc.Type != TypeGo || !svc.AutoDeploy {
		return false
	}
	if strings.TrimSpace(svc.Repo) == "" || strings.TrimSpace(svc.Branch) == "" {
		return false
	}
	return svc.Status != "building"
}

func (m *Manager) triggerAutoRedeploy(group, slug, sha string) {
	redeployGate.Lock()
	defer redeployGate.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	defer cancel()
	if _, err := m.Redeploy(ctx, group, slug); err != nil {
		if strings.Contains(err.Error(), "already running") {
			return
		}
		m.logf("warn", "Auto-deploy %s/%s failed · %s", group, slug, err.Error())
		return
	}
	// Stamp immediately so the poller does not queue another redeploy mid-build.
	m.setDeploySHA(group, slug, sha)
}

func (m *Manager) setDeploySHA(group, slug, sha string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 {
		return
	}
	svc.DeploySHA = strings.TrimSpace(sha)
	if !svc.AutoDeploySet {
		svc.AutoDeploy = true
		svc.AutoDeploySet = true
	}
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	reg.Services[idx] = svc
	_ = m.saveRegistry(reg)
	_ = m.writeMeta(svc)
}

// NoteSuccessfulDeploySHA records the commit after a successful build.
func (m *Manager) NoteSuccessfulDeploySHA(group, slug, sha string) {
	if sha = strings.TrimSpace(sha); sha == "" {
		return
	}
	m.setDeploySHA(group, slug, sha)
}

func (m *Manager) githubBranchSHA(ctx context.Context, token, repo, branch string) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/commits/%s", repo, branch)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "firewifi-dashboard")
	resp, err := ghHTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github commit %s@%s (%d)", repo, branch, resp.StatusCode)
	}
	var payload struct {
		SHA string `json:"sha"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	return strings.TrimSpace(payload.SHA), nil
}

// HookRedeployRequest is the body for POST /api/hooks/redeploy.
type HookRedeployRequest struct {
	Group  string `json:"group"`
	Slug   string `json:"slug"`
	Repo   string `json:"repo"`
	Branch string `json:"branch"`
}

// RedeployFromHook redeploys by explicit group/slug or by repo(+branch).
func (m *Manager) RedeployFromHook(ctx context.Context, in HookRedeployRequest) ([]Service, error) {
	group := strings.TrimSpace(in.Group)
	slug := strings.TrimSpace(in.Slug)
	if group != "" && slug != "" {
		svc, err := m.Redeploy(ctx, group, slug)
		if err != nil {
			return nil, err
		}
		return []Service{svc}, nil
	}
	repo := normalizeRepo(in.Repo)
	if repo == "" {
		return nil, fmt.Errorf("group+slug or repo required")
	}
	matches := m.servicesForRepo(repo, strings.TrimSpace(in.Branch))
	if len(matches) == 0 {
		return nil, fmt.Errorf("no service matches repo %s", repo)
	}
	out := make([]Service, 0, len(matches))
	for _, svc := range matches {
		s, err := m.Redeploy(ctx, svc.Group, svc.Slug)
		if err != nil {
			return out, err
		}
		out = append(out, s)
	}
	return out, nil
}

func (m *Manager) servicesForRepo(repo, branch string) []Service {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return nil
	}
	repo = normalizeRepo(repo)
	branch = strings.TrimSpace(branch)
	var out []Service
	for _, svc := range reg.Services {
		if svc.Type != TypeGo {
			continue
		}
		if normalizeRepo(svc.Repo) != repo {
			continue
		}
		if branch != "" && strings.TrimSpace(svc.Branch) != branch {
			continue
		}
		out = append(out, svc)
	}
	return out
}

type githubPushHook struct {
	Ref        string `json:"ref"`
	After      string `json:"after"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
}

// HandleGitHubPush matches push events to registry services and redeploys.
// Webhook secret must equal the FireWifi deploy token (HMAC SHA-256).
func (m *Manager) HandleGitHubPush(ctx context.Context, body []byte, signature string) ([]Service, error) {
	want, err := m.readDeployToken()
	if err != nil {
		return nil, err
	}
	if !validGitHubSignature(body, signature, want) {
		return nil, ErrUnauthorized
	}
	var push githubPushHook
	if err := json.Unmarshal(body, &push); err != nil {
		return nil, fmt.Errorf("bad json")
	}
	repo := normalizeRepo(push.Repository.FullName)
	branch := strings.TrimPrefix(push.Ref, "refs/heads/")
	if repo == "" || branch == "" || branch == push.Ref {
		return nil, fmt.Errorf("invalid push payload")
	}
	matches := m.servicesForRepo(repo, branch)
	if len(matches) == 0 {
		return nil, fmt.Errorf("no service matches %s@%s", repo, branch)
	}
	out := make([]Service, 0, len(matches))
	for _, svc := range matches {
		if !svc.AutoDeploy {
			continue
		}
		s, err := m.Redeploy(ctx, svc.Group, svc.Slug)
		if err != nil {
			return out, err
		}
		if push.After != "" && push.After != strings.Repeat("0", 40) {
			m.setDeploySHA(svc.Group, svc.Slug, push.After)
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("matching services have auto-deploy disabled")
	}
	return out, nil
}

func validGitHubSignature(body []byte, header, secret string) bool {
	header = strings.TrimSpace(header)
	const prefix = "sha256="
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	got, err := hex.DecodeString(strings.TrimPrefix(header, prefix))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hmac.Equal(got, mac.Sum(nil))
}
