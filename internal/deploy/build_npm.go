package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"firewifi/dashboard/internal/deploy/cache"
)

// prepareNPMLayers restores npm caches for a Node build tree under srcDir.
// Returns docker volume mounts, env vars, and a shell prelude for npm ci.
// Safe no-op helpers until a Node service type is added.
func (m *Manager) prepareNPMLayers(group, slug, srcDir string) (vols []string, env []string, shell string, err error) {
	if m.Cache == nil {
		m.Cache = cache.New(m.DeployDir)
	}
	if !cache.DetectNPM(srcDir) {
		return nil, nil, "", fmt.Errorf("not a node project")
	}
	download, modules, err := m.Cache.OpenNPM(group, slug, srcDir)
	if err != nil {
		return nil, nil, "", err
	}
	m.logf("info", "Cache %s", download.Summary())
	m.logf("info", "Cache %s", modules.Summary())

	restored, err := m.Cache.PrepareNPMModules(modules, srcDir)
	if err != nil {
		return nil, nil, "", err
	}
	if restored {
		m.logf("info", "Restored node_modules from lockfile layer")
	}
	vol, env := cache.NPMCacheMount(download)
	vols = []string{vol}
	shell = cache.NPMInstallShell(restored)
	// Stash layers on disk path for commit after successful install via rememberNPMLayers.
	_ = os.WriteFile(filepath.Join(m.serviceDir(group, slug), ".npm-layer-key"), []byte(modules.Key), 0o644)
	_ = download
	return vols, env, shell, nil
}

func (m *Manager) commitNPMLayers(ctx context.Context, group, slug, srcDir string) error {
	_ = ctx
	if m.Cache == nil {
		return nil
	}
	download, modules, err := m.Cache.OpenNPM(group, slug, srcDir)
	if err != nil {
		return err
	}
	if modules.Hit && !modules.Changed {
		return m.Cache.Remember(group, slug, download, modules)
	}
	if err := m.Cache.CommitNPMModules(modules, srcDir); err != nil {
		m.logf("warn", "npm layer commit skipped: %s", err.Error())
		return m.Cache.Remember(group, slug, download)
	}
	m.logf("ok", "npm node_modules layer saved (%s)", modules.Key[:12])
	return m.Cache.Remember(group, slug, download, modules)
}
