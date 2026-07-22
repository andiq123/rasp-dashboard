package deploy

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DeployQueued     = "queued"
	DeployBuilding   = "building"
	DeployActive     = "active"
	DeployFailed     = "failed"
	DeployArchived   = "archived"
	deployHistoryMax = 8
)

// Deployment is one Railway-style deploy attempt for a Go service.
type Deployment struct {
	ID         string `json:"id"`
	Group      string `json:"group"`
	Slug       string `json:"slug"`
	Status     string `json:"status"`
	Repo       string `json:"repo,omitempty"`
	Branch     string `json:"branch,omitempty"`
	Commit     string `json:"commit,omitempty"`
	CreatedAt  string `json:"created_at"`
	FinishedAt string `json:"finished_at,omitempty"`
	Error      string `json:"error,omitempty"`
	Active     bool   `json:"active,omitempty"`
}

type deploymentStore struct {
	Deployments []Deployment `json:"deployments"`
}

var deployFileMu sync.Mutex

func newDeployID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("dpl_%d", time.Now().UnixNano()%0xffffffff)
	}
	return "dpl_" + hex.EncodeToString(b[:])
}

func (m *Manager) deploymentsPath(group, slug string) string {
	return filepath.Join(m.serviceDir(group, slug), "deployments.json")
}

func (m *Manager) stagingDir(group, slug, deployID string) string {
	return filepath.Join(m.serviceDir(group, slug), "out", "builds", deployID)
}

func (m *Manager) stagingBinary(group, slug, deployID string) string {
	return filepath.Join(m.stagingDir(group, slug, deployID), "app")
}

func (m *Manager) loadDeploymentsLocked(group, slug string) ([]Deployment, error) {
	path := m.deploymentsPath(group, slug)
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var store deploymentStore
	if err := json.Unmarshal(b, &store); err != nil {
		return nil, err
	}
	return store.Deployments, nil
}

func (m *Manager) saveDeploymentsLocked(group, slug string, list []Deployment) error {
	path := m.deploymentsPath(group, slug)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(deploymentStore{Deployments: list}, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// StartDeployment appends a building record for a new deploy attempt.
func (m *Manager) StartDeployment(svc Service, commit string) (Deployment, error) {
	deployFileMu.Lock()
	defer deployFileMu.Unlock()
	list, err := m.loadDeploymentsLocked(svc.Group, svc.Slug)
	if err != nil {
		return Deployment{}, err
	}
	d := Deployment{
		ID:        newDeployID(),
		Group:     svc.Group,
		Slug:      svc.Slug,
		Status:    DeployBuilding,
		Repo:      svc.Repo,
		Branch:    svc.Branch,
		Commit:    strings.TrimSpace(commit),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Active:    false,
	}
	list = append([]Deployment{d}, list...)
	if err := m.saveDeploymentsLocked(svc.Group, svc.Slug, list); err != nil {
		return Deployment{}, err
	}
	return d, nil
}

// FailDeployment marks a building deploy as failed.
func (m *Manager) FailDeployment(group, slug, id, errMsg string) {
	deployFileMu.Lock()
	defer deployFileMu.Unlock()
	list, err := m.loadDeploymentsLocked(group, slug)
	if err != nil {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	errMsg = strings.TrimSpace(errMsg)
	if len(errMsg) > 400 {
		errMsg = errMsg[:400] + "…"
	}
	for i := range list {
		if list[i].ID != id {
			continue
		}
		list[i].Status = DeployFailed
		list[i].Active = false
		list[i].FinishedAt = now
		list[i].Error = errMsg
		break
	}
	_ = m.saveDeploymentsLocked(group, slug, list)
	// Staging binary is useless after failure — free disk, keep clone.
	_ = os.RemoveAll(m.stagingDir(group, slug, id))
}

// PromoteDeployment marks id active and archives previous active; prunes history.
func (m *Manager) PromoteDeployment(group, slug, id string) error {
	deployFileMu.Lock()
	defer deployFileMu.Unlock()
	list, err := m.loadDeploymentsLocked(group, slug)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	found := false
	for i := range list {
		if list[i].ID == id {
			list[i].Status = DeployActive
			list[i].Active = true
			list[i].FinishedAt = now
			list[i].Error = ""
			found = true
			continue
		}
		if list[i].Status == DeployActive || list[i].Active {
			list[i].Status = DeployArchived
			list[i].Active = false
			if list[i].FinishedAt == "" {
				list[i].FinishedAt = now
			}
		}
	}
	if !found {
		return fmt.Errorf("deployment %s not found", id)
	}
	pruned := list
	if len(pruned) > deployHistoryMax {
		pruned = pruned[:deployHistoryMax]
	}
	removed := diffDeployIDs(list, pruned)
	if err := m.saveDeploymentsLocked(group, slug, pruned); err != nil {
		return err
	}
	for _, rid := range removed {
		_ = os.RemoveAll(m.stagingDir(group, slug, rid))
		m.removeDeployLog(group, slug, rid)
	}
	return nil
}

func diffDeployIDs(before, after []Deployment) []string {
	keep := map[string]struct{}{}
	for _, d := range after {
		keep[d.ID] = struct{}{}
	}
	var gone []string
	for _, d := range before {
		if _, ok := keep[d.ID]; !ok {
			gone = append(gone, d.ID)
		}
	}
	return gone
}

// ListDeployments returns newest-first history (limit 0 = all retained).
func (m *Manager) ListDeployments(group, slug string, limit int) ([]Deployment, error) {
	deployFileMu.Lock()
	defer deployFileMu.Unlock()
	list, err := m.loadDeploymentsLocked(group, slug)
	if err != nil {
		return nil, err
	}
	if limit > 0 && len(list) > limit {
		list = append([]Deployment(nil), list[:limit]...)
	} else {
		list = append([]Deployment(nil), list...)
	}
	return list, nil
}

func activeDeployIDFromList(list []Deployment) string {
	for _, d := range list {
		if d.Status == DeployActive || d.Active {
			return d.ID
		}
	}
	return ""
}

func (m *Manager) attachDeployments(svc *Service) {
	if svc == nil || svc.Type != TypeGo {
		return
	}
	list, err := m.ListDeployments(svc.Group, svc.Slug, 0)
	if err != nil {
		return
	}
	svc.ActiveDeployID = activeDeployIDFromList(list)
	if len(list) > 5 {
		list = list[:5]
	}
	svc.Deployments = list
}

func gitHeadCommit(repoDir string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "-C", repoDir, "rev-parse", "--short", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// ensureExecutable makes path executable for the dashboard user.
// Docker builds without --user can leave root-owned files; rewrite into a user-owned copy.
func ensureExecutable(path string) error {
	if err := os.Chmod(path, 0o755); err == nil {
		return nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read binary: %w", err)
	}
	tmp := path + ".owned"
	if err := os.WriteFile(tmp, b, 0o755); err != nil {
		return fmt.Errorf("rewrite binary: %w", err)
	}
	_ = os.Remove(path) // may fail if root-owned; rename over still works on same dir sometimes
	if err := os.Rename(tmp, path); err != nil {
		// Last resort: leave .owned and try to replace via remove+rename
		_ = os.Remove(path)
		if err2 := os.Rename(tmp, path); err2 != nil {
			return fmt.Errorf("install binary (permission): %w", err)
		}
	}
	return os.Chmod(path, 0o755)
}

// promoteBinary moves staging app into the live out/app path.
func (m *Manager) promoteBinary(group, slug, deployID string) error {
	src := m.stagingBinary(group, slug, deployID)
	dst := m.binaryPath(group, slug)
	if _, err := os.Stat(src); err != nil {
		return fmt.Errorf("staging binary missing")
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := ensureExecutable(src); err != nil {
		return err
	}
	_ = os.Remove(dst)
	if err := os.Rename(src, dst); err != nil {
		b, err2 := os.ReadFile(src)
		if err2 != nil {
			return err
		}
		tmp := dst + ".new"
		if err2 = os.WriteFile(tmp, b, 0o755); err2 != nil {
			return err2
		}
		_ = os.Remove(dst)
		if err2 = os.Rename(tmp, dst); err2 != nil {
			return err2
		}
		_ = os.Remove(src)
	}
	return ensureExecutable(dst)
}

func (m *Manager) findDeployment(group, slug, id string) (Deployment, bool) {
	list, err := m.ListDeployments(group, slug, 0)
	if err != nil {
		return Deployment{}, false
	}
	for _, d := range list {
		if d.ID == id {
			return d, true
		}
	}
	return Deployment{}, false
}

func (m *Manager) activeDeployID(group, slug string) string {
	list, err := m.ListDeployments(group, slug, 0)
	if err != nil {
		return ""
	}
	return activeDeployIDFromList(list)
}
