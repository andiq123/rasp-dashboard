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
	"time"
)

const (
	autoDeployInitial  = 5 * time.Second
	autoDeployInterval = 30 * time.Second
	deployTokenBytes   = 32
)

// ErrUnauthorized is returned when a deploy hook token/signature is invalid.
var ErrUnauthorized = errors.New("unauthorized")

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

// BootstrapAutoDeploy enables defaults, backfills push webhooks, and starts the commit watcher.
func (m *Manager) BootstrapAutoDeploy() {
	m.autoDeployOnce.Do(func() {
		if _, err := m.EnsureDeployToken(); err != nil {
			m.logf("warn", "Auto-deploy token: %v", err)
		}
		m.enableAutoDeployDefaults()
		m.startBackground(m.ensureAutoDeployHooksForRegistry)
		m.startBackground(m.autoDeployLoop)
	})
}

// ensureAutoDeployHooksForRegistry installs GitHub push webhooks for existing Go services.
// Idempotent: skips repos that already have the FireWifi hook.
func (m *Manager) ensureAutoDeployHooksForRegistry() {
	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return
	}
	seen := map[string]bool{}
	for _, svc := range reg.Services {
		if svc.Type != TypeGo || !svc.AutoDeploy {
			continue
		}
		repo := normalizeRepo(svc.Repo)
		if repo == "" || seen[repo] {
			continue
		}
		seen[repo] = true
		m.ensureAutoDeployGitHub(repo)
	}
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
	timer := time.NewTimer(autoDeployInitial)
	defer timer.Stop()
	for {
		select {
		case <-m.bgDone():
			return
		case <-timer.C:
			m.pollAutoDeploys()
			timer.Reset(autoDeployInterval)
		}
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

	type target struct {
		repo     string
		branch   string
		services []Service
	}
	targets := make([]target, 0)
	targetIndex := make(map[string]int)
	for _, svc := range reg.Services {
		if !m.shouldPollService(svc) {
			continue
		}
		repo := normalizeRepo(svc.Repo)
		branch := strings.TrimSpace(svc.Branch)
		key := repo + "\x00" + branch
		idx, ok := targetIndex[key]
		if !ok {
			idx = len(targets)
			targetIndex[key] = idx
			targets = append(targets, target{repo: repo, branch: branch})
		}
		targets[idx].services = append(targets[idx].services, svc)
	}

	// Services sharing a repository and branch share one GitHub request.
	for _, target := range targets {
		sha, err := m.githubBranchSHA(ctx, token, target.repo, target.branch)
		if err != nil || sha == "" {
			continue
		}
		for _, svc := range target.services {
			knownSHA := strings.TrimSpace(svc.DeploySHA)
			if knownSHA == "" {
				// Older/failed deploys may not have deploy_sha yet. The retained clone
				// is still authoritative enough to detect the next pushed commit.
				knownSHA = gitHeadCommit(filepath.Join(m.serviceDir(svc.Group, svc.Slug), "repo"))
			}
			if knownSHA == "" {
				m.setDeploySHA(svc.Group, svc.Slug, sha)
				continue
			}
			if sameCommit(knownSHA, sha) {
				if svc.DeploySHA == "" {
					m.setDeploySHA(svc.Group, svc.Slug, sha)
				}
				continue
			}
			m.logf("info", "Auto-deploy %s/%s · new commit %s", svc.Group, svc.Slug, shortSHA(sha))
			if _, err := m.scheduleRedeploy(svc.Group, svc.Slug, "auto"); err != nil {
				m.logf("warn", "Auto-deploy %s/%s failed · %s", svc.Group, svc.Slug, err.Error())
			} else {
				// Record an accepted attempt so a broken commit does not rebuild every
				// poll. A later push has a new SHA and will schedule normally.
				m.setDeploySHA(svc.Group, svc.Slug, sha)
			}
		}
	}
}

func (m *Manager) shouldPollService(svc Service) bool {
	if svc.Type != TypeGo || !svc.AutoDeploy {
		return false
	}
	if strings.TrimSpace(svc.Repo) == "" || strings.TrimSpace(svc.Branch) == "" {
		return false
	}
	// Allow queueing while another service builds; skip mid-build (queued still polls to coalesce new SHAs).
	return svc.Status != "building"
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
		s, err := m.runGoDeployReason(ctx, mustPlanRedeploy(m, svc), "webhook")
		if err != nil {
			return out, err
		}
		out = append(out, s)
	}
	return out, nil
}

func mustPlanRedeploy(m *Manager, svc Service) goDeployPlan {
	plan, err := m.planGoDeploy(svc.Group, redeployGoRequest(svc), svc.Slug)
	if err != nil {
		return goDeployPlan{Group: svc.Group, Slug: svc.Slug, Name: svc.Name, Request: redeployGoRequest(svc), Reuse: true}
	}
	plan.Reuse = true
	return plan
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
func (m *Manager) HandleGitHubPush(_ context.Context, body []byte, signature string) ([]Service, error) {
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
		s, err := m.scheduleRedeploy(svc.Group, svc.Slug, "webhook")
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

// ensureAutoDeployGitHub installs a push webhook when FIREWIFI_PUBLIC_URL is set.
// Polling remains the fallback so auto-deploy still works on LAN-only Pis.
func (m *Manager) ensureAutoDeployGitHub(repo string) {
	repo = normalizeRepo(repo)
	if repo == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := m.EnsureGitHubPushHook(ctx, repo); err != nil {
		m.logf("info", "Auto-deploy %s · %v · polling every %s", repo, err, autoDeployInterval)
		return
	}
	m.logf("ok", "Auto-deploy %s · GitHub push webhook ready", repo)
}

func publicGitHubHookURL() string {
	base := strings.TrimSpace(os.Getenv("FIREWIFI_PUBLIC_URL"))
	if base == "" {
		return ""
	}
	return strings.TrimRight(base, "/") + "/api/hooks/github"
}

// EnsureGitHubPushHook creates (or reuses) a repo webhook that hits /api/hooks/github.
func (m *Manager) EnsureGitHubPushHook(ctx context.Context, repo string) error {
	hookURL := publicGitHubHookURL()
	if hookURL == "" {
		return fmt.Errorf("set FIREWIFI_PUBLIC_URL for instant push redeploy")
	}
	token, err := m.readToken()
	if err != nil {
		return err
	}
	if strings.TrimSpace(token) == "" {
		return fmt.Errorf("GitHub not connected")
	}
	secret, err := m.EnsureDeployToken()
	if err != nil {
		return err
	}
	listURL := fmt.Sprintf("https://api.github.com/repos/%s/hooks?per_page=100", repo)
	body, code, err := m.ghDo(ctx, http.MethodGet, listURL, token, nil)
	if err != nil {
		return err
	}
	if code != http.StatusOK {
		return fmt.Errorf("list webhooks (%d)", code)
	}
	var hooks []struct {
		ID     int64 `json:"id"`
		Active bool  `json:"active"`
		Config struct {
			URL string `json:"url"`
		} `json:"config"`
	}
	if err := json.Unmarshal(body, &hooks); err != nil {
		return err
	}
	for _, h := range hooks {
		if strings.TrimRight(strings.TrimSpace(h.Config.URL), "/") == strings.TrimRight(hookURL, "/") {
			if !h.Active {
				_, code, err := m.ghDo(ctx, http.MethodPatch,
					fmt.Sprintf("https://api.github.com/repos/%s/hooks/%d", repo, h.ID),
					token, map[string]any{"active": true})
				if err != nil {
					return err
				}
				if code != http.StatusOK {
					return fmt.Errorf("activate webhook (%d)", code)
				}
			}
			return nil
		}
	}
	insecure := "0"
	if strings.HasPrefix(strings.ToLower(hookURL), "http://") {
		insecure = "1"
	}
	payload := map[string]any{
		"name":   "web",
		"active": true,
		"events": []string{"push"},
		"config": map[string]string{
			"url":          hookURL,
			"content_type": "json",
			"secret":       secret,
			"insecure_ssl": insecure,
		},
	}
	_, code, err = m.ghDo(ctx, http.MethodPost, fmt.Sprintf("https://api.github.com/repos/%s/hooks", repo), token, payload)
	if err != nil {
		return err
	}
	if code != http.StatusCreated && code != http.StatusOK {
		return fmt.Errorf("create webhook (%d)", code)
	}
	return nil
}
