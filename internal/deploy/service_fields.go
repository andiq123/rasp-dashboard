package deploy

import (
	"fmt"
	"reflect"
	"strings"
	"time"
)

// mergeServicePreserve keeps operator-owned fields when a deploy pipeline
// rebuilds a Service value from scratch (redeploy / createGo).
func mergeServicePreserve(prev, next Service) Service {
	if !next.AutoDeploySet && prev.AutoDeploySet {
		next.AutoDeploy = prev.AutoDeploy
		next.AutoDeploySet = true
	}
	if next.DeploySHA == "" {
		next.DeploySHA = prev.DeploySHA
	}
	if next.PublicURL == "" {
		next.PublicURL = prev.PublicURL
	}
	if next.StaticHost == "" {
		next.StaticHost = prev.StaticHost
	}
	if next.TunnelMode == "" {
		next.TunnelMode = prev.TunnelMode
	}
	if next.TunnelHostname == "" {
		next.TunnelHostname = prev.TunnelHostname
	}
	if next.PublicURL != "" && !next.TunnelVerified {
		next.TunnelVerified = prev.TunnelVerified
	}
	if !next.TunnelConfigured {
		next.TunnelConfigured = prev.TunnelConfigured
	}
	return next
}

func sameCommit(a, b string) bool {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	return strings.HasPrefix(a, b) || strings.HasPrefix(b, a)
}

func shortSHA(sha string) string {
	sha = strings.TrimSpace(sha)
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

func localOriginURL(port int) string {
	if port <= 0 {
		return ""
	}
	return fmt.Sprintf("http://127.0.0.1:%d", port)
}

// updateService changes the stored copy of one service under the registry
// lock. Callers that probed a tunnel or started a container hold a Service
// value read seconds earlier; writing that whole value back would revert any
// settings saved in the meantime, so they patch only the fields they own.
// Nothing is written (and no change event is sent) when the patch is a no-op.
func (m *Manager) updateService(group, slug string, apply func(cur *Service)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return err
	}
	if m.isDeleting(group, slug) {
		return fmt.Errorf("service is being deleted")
	}
	cur, idx := findService(reg, group, slug)
	if idx < 0 {
		// Do not resurrect a service removed while the caller was working.
		return fmt.Errorf("service not found")
	}
	before := cur
	apply(&cur)
	if reflect.DeepEqual(before, cur) {
		return nil
	}
	cur.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	reg.Services[idx] = cur
	if err := m.saveRegistry(reg); err != nil {
		return err
	}
	return m.writeMeta(cur)
}

// persistTunnelState stores exactly the public-URL and tunnel fields of svc,
// including cleared ones, and leaves every other stored field alone.
func (m *Manager) persistTunnelState(svc Service) error {
	return m.updateService(svc.Group, svc.Slug, func(cur *Service) {
		cur.PublicURL = svc.PublicURL
		cur.PublicPath = svc.PublicPath
		cur.StaticHost = svc.StaticHost
		cur.TunnelActive = svc.TunnelActive
		cur.TunnelConnected = svc.TunnelConnected
		cur.TunnelVerified = svc.TunnelVerified
		cur.TunnelConfigured = svc.TunnelConfigured
		cur.TunnelMode = svc.TunnelMode
		cur.TunnelHostname = svc.TunnelHostname
		cur.TunnelState = svc.TunnelState
		cur.TunnelID = svc.TunnelID
	})
}

// persistRunState stores the outcome of a start, stop or restart.
func (m *Manager) persistRunState(svc Service) {
	_ = m.updateService(svc.Group, svc.Slug, func(cur *Service) {
		cur.Running = svc.Running
		cur.Status = svc.Status
		cur.LastError = svc.LastError
	})
}
