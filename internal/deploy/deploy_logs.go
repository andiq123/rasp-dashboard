package deploy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var deployLogMu sync.Mutex

func (m *Manager) deployLogPath(group, slug, deployID string) string {
	return filepath.Join(m.serviceDir(group, slug), "logs", deployID+".jsonl")
}

func parseJobScope(scope string) (group, slug string, ok bool) {
	scope = strings.TrimSpace(scope)
	i := strings.IndexByte(scope, '/')
	if i <= 0 || i >= len(scope)-1 {
		return "", "", false
	}
	return scope[:i], scope[i+1:], true
}

func (m *Manager) resetDeployLog(group, slug, deployID string) {
	if m == nil || group == "" || slug == "" || deployID == "" {
		return
	}
	deployLogMu.Lock()
	defer deployLogMu.Unlock()
	path := m.deployLogPath(group, slug, deployID)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(path, nil, 0o644)
}

func (m *Manager) appendDeployLog(group, slug, deployID string, line ActivityLine) {
	if m == nil || group == "" || slug == "" || deployID == "" {
		return
	}
	deployLogMu.Lock()
	defer deployLogMu.Unlock()
	path := m.deployLogPath(group, slug, deployID)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	b, err := json.Marshal(line)
	if err != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.Write(append(b, '\n'))
	_ = f.Close()
}

// ReadDeployLogs returns persisted lines for a deployment (survives refresh / page leave).
func (m *Manager) ReadDeployLogs(group, slug, deployID string) ([]ActivityLine, error) {
	if err := requireSlug(group, "group"); err != nil {
		return nil, err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return nil, err
	}
	deployID = strings.TrimSpace(deployID)
	if deployID == "" || !strings.HasPrefix(deployID, "dpl_") {
		return nil, fmt.Errorf("deployment not found")
	}
	deployLogMu.Lock()
	defer deployLogMu.Unlock()
	path := m.deployLogPath(group, slug, deployID)
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []ActivityLine{}, nil
		}
		return nil, err
	}
	defer f.Close()
	var out []ActivityLine
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		var line ActivityLine
		if json.Unmarshal(sc.Bytes(), &line) != nil {
			continue
		}
		out = append(out, line)
	}
	return out, sc.Err()
}

func (m *Manager) removeDeployLog(group, slug, deployID string) {
	if m == nil || deployID == "" {
		return
	}
	deployLogMu.Lock()
	defer deployLogMu.Unlock()
	_ = os.Remove(m.deployLogPath(group, slug, deployID))
}

// DeploymentID returns the active job's deployment id (empty if none).
func (h *ActivityHub) DeploymentID() string {
	if h == nil {
		return ""
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.deploymentID
}
