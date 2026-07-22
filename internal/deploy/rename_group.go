package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// RenameGroup updates the display name and, when the slug changes, migrates
// disk paths, registry rows, cache state, and Docker containers.
func (m *Manager) RenameGroup(ctx context.Context, oldSlug, newName string) (Group, error) {
	if err := requireSlug(oldSlug, "group"); err != nil {
		return Group{}, err
	}
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return Group{}, fmt.Errorf("name required")
	}
	newSlug := slugify(newName)
	if newSlug == "" {
		return Group{}, fmt.Errorf("invalid name")
	}

	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return Group{}, err
	}
	g, idx := findGroup(reg, oldSlug)
	if idx < 0 {
		m.mu.Unlock()
		return Group{}, fmt.Errorf("group not found")
	}

	// Display-only rename (slug unchanged).
	if newSlug == oldSlug {
		g.Name = newName
		g.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		reg.Groups[idx] = g
		if err := m.saveRegistry(reg); err != nil {
			m.mu.Unlock()
			return Group{}, err
		}
		m.mu.Unlock()
		m.logf("ok", "Group renamed · %s", newName)
		return g, nil
	}

	if _, hit := findGroup(reg, newSlug); hit >= 0 {
		m.mu.Unlock()
		return Group{}, fmt.Errorf("group %s already exists", newSlug)
	}
	m.mu.Unlock()

	if err := m.acquireJob("Rename group · "+g.Name+" → "+newName, oldSlug); err != nil {
		return Group{}, err
	}
	m.logf("step", "Renaming group %s → %s", oldSlug, newSlug)

	// Snapshot services while unlocked carefully under lock again.
	m.mu.Lock()
	reg, err = m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	g, idx = findGroup(reg, oldSlug)
	if idx < 0 {
		m.mu.Unlock()
		err := fmt.Errorf("group not found")
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	if _, hit := findGroup(reg, newSlug); hit >= 0 {
		m.mu.Unlock()
		err := fmt.Errorf("group %s already exists", newSlug)
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	var svcs []Service
	for _, s := range reg.Services {
		if s.Group == oldSlug {
			svcs = append(svcs, s)
		}
	}
	m.mu.Unlock()

	// Stop old-named containers before moving paths.
	m.logf("info", "Stopping %d container(s)", len(svcs))
	wasRunning := map[string]bool{}
	for _, s := range svcs {
		if s.Type != TypeGo {
			continue
		}
		name := containerName(oldSlug, s.Slug)
		if m.containerRunning(ctx, name) {
			wasRunning[s.Slug] = true
		}
		m.removeServiceContainers(ctx, oldSlug, s.Slug)
	}

	oldDir := m.groupDir(oldSlug)
	newDir := m.groupDir(newSlug)
	if _, err := os.Stat(newDir); err == nil {
		m.releaseJob(false, "target folder already exists")
		return Group{}, fmt.Errorf("target folder already exists: %s", newSlug)
	}
	if _, err := os.Stat(oldDir); err == nil {
		m.logf("info", "Moving %s → %s", oldDir, newDir)
		if err := os.MkdirAll(filepath.Dir(newDir), 0o755); err != nil {
			m.releaseJob(false, err.Error())
			return Group{}, err
		}
		if err := os.Rename(oldDir, newDir); err != nil {
			m.releaseJob(false, err.Error())
			return Group{}, fmt.Errorf("move group files: %w", err)
		}
	} else {
		_ = os.MkdirAll(newDir, 0o755)
	}

	// Cache fingerprint state: cache/state/<group>/
	if m.Cache != nil {
		oldState := filepath.Join(m.Cache.Root, "state", oldSlug)
		newState := filepath.Join(m.Cache.Root, "state", newSlug)
		if _, err := os.Stat(oldState); err == nil {
			_ = os.MkdirAll(filepath.Dir(newState), 0o755)
			if err := os.Rename(oldState, newState); err != nil {
				m.logf("warn", "Cache state move: %v", err)
			} else {
				m.logf("info", "Moved cache state")
			}
		}
	}

	m.mu.Lock()
	reg, err = m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	g, idx = findGroup(reg, oldSlug)
	if idx < 0 {
		m.mu.Unlock()
		err := fmt.Errorf("group disappeared during rename")
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	g.Slug = newSlug
	g.Name = newName
	g.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	g.RenamedFrom = oldSlug
	reg.Groups[idx] = g
	for i := range reg.Services {
		if reg.Services[i].Group != oldSlug {
			continue
		}
		reg.Services[i].Group = newSlug
		reg.Services[i].UpdatedAt = g.UpdatedAt
		_ = m.writeMeta(reg.Services[i])
	}
	if err := m.saveRegistry(reg); err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	// Copy services for restart outside lock
	var restart []Service
	for _, s := range reg.Services {
		if s.Group == newSlug && s.Type == TypeGo && wasRunning[s.Slug] {
			restart = append(restart, s)
		}
	}
	m.mu.Unlock()

	for _, s := range restart {
		m.logf("info", "Restarting %s/%s under new name", newSlug, s.Slug)
		if err := m.recreateGo(ctx, s); err != nil {
			m.logf("warn", "Restart %s failed: %v", s.Slug, err)
		}
	}

	m.releaseJob(true, fmt.Sprintf("Renamed · %s → %s", oldSlug, newSlug))
	out := g
	out.RenamedFrom = oldSlug
	return out, nil
}
