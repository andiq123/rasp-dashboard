package deploy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// adoptOrphansLocked registers on-disk service folders that never made it into
// the registry (typical after a failed first deploy). Caller must hold m.mu.
func (m *Manager) adoptOrphansLocked(reg *registry) bool {
	changed := false
	for _, g := range reg.Groups {
		ents, err := os.ReadDir(m.groupDir(g.Slug))
		if err != nil {
			continue
		}
		for _, ent := range ents {
			if !ent.IsDir() {
				continue
			}
			slug := ent.Name()
			if !validSlug(slug) {
				continue
			}
			if _, idx := findService(*reg, g.Slug, slug); idx >= 0 {
				continue
			}
			dir := m.serviceDir(g.Slug, slug)
			svc := Service{
				Group:     g.Slug,
				Slug:      slug,
				Type:      TypeGo,
				Name:      slug,
				Status:    "failed",
				LastError: "Adopted leftover files from a failed deploy",
				UpdatedAt: time.Now().UTC().Format(time.RFC3339),
			}
			if b, err := os.ReadFile(filepath.Join(dir, "meta.json")); err == nil {
				var meta Service
				if json.Unmarshal(b, &meta) == nil {
					if meta.Name != "" {
						svc.Name = meta.Name
					}
					if meta.Repo != "" {
						svc.Repo = meta.Repo
					}
					if meta.Branch != "" {
						svc.Branch = meta.Branch
					}
					if meta.Port > 0 {
						svc.Port = meta.Port
					}
					if meta.Cmd != "" {
						svc.Cmd = meta.Cmd
					}
					if meta.RootDir != "" {
						svc.RootDir = meta.RootDir
					}
					if meta.BuildCmd != "" {
						svc.BuildCmd = meta.BuildCmd
					}
					if meta.MemoryMB > 0 {
						svc.MemoryMB = meta.MemoryMB
					}
					if meta.CPUs > 0 {
						svc.CPUs = meta.CPUs
					}
					if meta.LinkedDatabase != "" {
						svc.LinkedDatabase = meta.LinkedDatabase
					}
					if meta.Type == TypePostgres {
						svc.Type = TypePostgres
						svc.Database = meta.Database
						svc.Status = "stopped"
						svc.LastError = ""
					}
				}
			}
			m.applyDisk(&svc)
			if svc.DiskBytes == 0 {
				continue
			}
			reg.Services = append(reg.Services, svc)
			changed = true
			m.logf("warn", "Adopted orphan %s/%s · %s on disk", svc.Group, svc.Slug, fmtBytes(svc.DiskBytes))
		}
	}
	if changed {
		_ = m.saveRegistry(*reg)
	}
	return changed
}
