package deploy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// pruneMissingRedisRecordsLocked removes legacy phantom Redis rows left by the
// pre-fix create/adopt race. A managed Redis service cannot be recovered or
// restarted without its private service directory and credential env file.
// Caller must hold m.mu.
func (m *Manager) pruneMissingRedisRecordsLocked(reg *registry) bool {
	if reg == nil || len(reg.Services) == 0 {
		return false
	}
	out := reg.Services[:0]
	changed := false
	for _, svc := range reg.Services {
		if svc.Type == TypeRedis && !m.isServiceProvisionPending(svc.Group, svc.Slug) {
			if _, err := os.Stat(m.serviceDir(svc.Group, svc.Slug)); os.IsNotExist(err) {
				changed = true
				m.logf("warn", "Removed stale Redis registry entry · %s/%s · credentials already gone", svc.Group, svc.Slug)
				continue
			}
		}
		out = append(out, svc)
	}
	if changed {
		reg.Services = out
	}
	return changed
}

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
					// Redis writes recovery metadata before Docker work begins. A live
					// services refresh must not adopt that temporary directory into the
					// registry or final registration will collide with its own entry.
					if meta.Status == "creating" && m.isServiceProvisionPending(g.Slug, slug) {
						continue
					}
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
					if meta.Volume != "" {
						svc.Volume = meta.Volume
					}
					if meta.EngineImage != "" {
						svc.EngineImage = meta.EngineImage
					}
					if meta.LinkedDatabase != "" {
						svc.LinkedDatabase = meta.LinkedDatabase
					}
					if meta.LinkedBucket != "" {
						svc.LinkedBucket = meta.LinkedBucket
					}
					if meta.LinkedRedis != "" {
						svc.LinkedRedis = meta.LinkedRedis
					}
					if meta.Type == TypePostgres {
						svc.Type = TypePostgres
						svc.Database = meta.Database
						svc.Status = "stopped"
						svc.LastError = ""
					}
					if meta.Type == TypeRedis {
						svc.Type = TypeRedis
						svc.Port = meta.Port
						if meta.Status == "creating" {
							svc.Status = "failed"
							svc.LastError = "Redis creation was interrupted — delete it or retry with a new name"
						} else {
							svc.Status = "stopped"
							svc.LastError = ""
						}
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
