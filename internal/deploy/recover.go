package deploy

import (
	"context"
	"strings"
	"time"
)

// RecoverInterruptedDeploys clears builds left mid-flight after a process crash/restart:
// registry "building", deployment records, and orphaned docker build containers.
func (m *Manager) RecoverInterruptedDeploys(ctx context.Context) {
	if m == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	stopCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return
	}
	changed := false
	var interrupted []Service
	for i := range reg.Services {
		svc := reg.Services[i]
		if svc.Type != TypeGo || svc.Status != "building" {
			continue
		}
		svc.Status = "failed"
		svc.Running = false
		if strings.TrimSpace(svc.LastError) == "" {
			svc.LastError = "Deploy interrupted — Redeploy to retry"
		}
		svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		reg.Services[i] = svc
		interrupted = append(interrupted, svc)
		changed = true
	}
	if changed {
		_ = m.saveRegistry(reg)
	}
	m.mu.Unlock()

	for _, svc := range interrupted {
		m.removeServiceContainers(stopCtx, svc.Group, svc.Slug)
		if id := strings.TrimSpace(svc.DeployID); id != "" {
			m.FailDeployment(svc.Group, svc.Slug, id, "interrupted — dashboard restarted or build cancelled")
			continue
		}
		list, err := m.ListDeployments(svc.Group, svc.Slug, 0)
		if err != nil {
			continue
		}
		for _, d := range list {
			if d.Status == DeployBuilding || d.Status == DeployQueued {
				m.FailDeployment(svc.Group, svc.Slug, d.ID, "interrupted — dashboard restarted or build cancelled")
			}
		}
	}

	m.sweepOrphanBuildContainers(stopCtx)
}

func (m *Manager) sweepOrphanBuildContainers(ctx context.Context) {
	out, err := m.dockerQuiet(ctx, "ps", "-a",
		"--filter", "label="+labelManaged+"=1",
		"--filter", "label="+labelRole+"=build",
		"--format", "{{.Names}}")
	if err != nil {
		out, err = m.dockerQuiet(ctx, "ps", "-a", "--filter", "name=fw-build-", "--format", "{{.Names}}")
		if err != nil {
			return
		}
	}
	nl := "\n"
	for _, name := range strings.Split(out, nl) {
		name = strings.TrimSpace(strings.TrimPrefix(name, "/"))
		if name == "" {
			continue
		}
		m.stopContainer(ctx, name)
	}
}

// persistInterruptedAsync writes a stuck "building" service as failed (no active job).
func (m *Manager) persistInterruptedAsync(svc Service) {
	go func(snap Service) {
		m.mu.Lock()
		reg, err := m.loadRegistry()
		if err != nil {
			m.mu.Unlock()
			return
		}
		cur, idx := findService(reg, snap.Group, snap.Slug)
		if idx < 0 || cur.Status != "building" {
			m.mu.Unlock()
			return
		}
		cur.Status = "failed"
		cur.Running = false
		if strings.TrimSpace(cur.LastError) == "" {
			cur.LastError = strings.TrimSpace(snap.LastError)
		}
		if cur.LastError == "" {
			cur.LastError = "Deploy interrupted — Redeploy to retry"
		}
		cur.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		reg.Services[idx] = cur
		deployID := strings.TrimSpace(cur.DeployID)
		group, slug := cur.Group, cur.Slug
		_ = m.saveRegistry(reg)
		m.mu.Unlock()

		if deployID != "" {
			m.FailDeployment(group, slug, deployID, "interrupted")
		}
		stopCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		m.removeServiceContainers(stopCtx, group, slug)
		cancel()
	}(svc)
}

func (m *Manager) persistCrashAsync(svc Service) {
	go func(snap Service) {
		m.mu.Lock()
		defer m.mu.Unlock()
		reg, err := m.loadRegistry()
		if err != nil {
			return
		}
		cur, idx := findService(reg, snap.Group, snap.Slug)
		if idx < 0 {
			return
		}
		if cur.Status == "building" {
			return
		}
		nextErr := strings.TrimSpace(snap.LastError)
		if cur.Status == "failed" && !cur.Running && nextErr != "" && cur.LastError == nextErr {
			return
		}
		cur.Status = "failed"
		cur.Running = false
		if strings.TrimSpace(snap.LastError) != "" {
			cur.LastError = snap.LastError
		}
		cur.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		reg.Services[idx] = cur
		_ = m.saveRegistry(reg)
		_ = m.writeMeta(cur)
	}(svc)
}
