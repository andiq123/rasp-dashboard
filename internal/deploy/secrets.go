package deploy

import (
	"os"
	"path/filepath"
	"strings"
)

// bootstrapSecretKeys are filled once with ${{secret(N)}} when missing/too short.
// Keep this list generic — never invent app-specific keys (CORS, etc.).
var bootstrapSecretKeys = []struct {
	Key string
	Len int
}{
	{"JWT_SECRET", 32},
}

// ensureBootstrapSecrets adds placeholders for missing auth secrets, then materializes them.
// When persist is true and anything changed, concrete bootstrap keys are written to the service env file.
func (m *Manager) ensureBootstrapSecrets(group, slug, body string, persist bool) (string, bool) {
	hints := m.envHintsFor(group, slug)
	body = ensureProductionEnv(body, hints)
	before := body
	body, _ = materializeSecrets(body)
	changed := normalizeEnv(before) != normalizeEnv(body)
	if !changed {
		return body, false
	}
	if persist && strings.TrimSpace(group) != "" && strings.TrimSpace(slug) != "" {
		path := filepath.Join(m.serviceDir(group, slug), "env")
		cur, _ := os.ReadFile(path)
		svc := m.serviceSnapshot(group, slug)
		next := ownEnvBody(string(cur), svc)
		merged := parseEnvMap(body)
		for _, s := range bootstrapSecretKeys {
			if v := strings.TrimSpace(merged[s.Key]); v != "" && !strings.Contains(v, "${{") {
				next = upsertEnv(next, s.Key, v)
			}
		}
		next = ensureProductionEnv(next, hints)
		next = ownEnvBody(next, svc)
		_ = os.WriteFile(path, []byte(normalizeEnv(next)), 0o600)
	}
	return body, true
}

func (m *Manager) serviceSnapshot(group, slug string) Service {
	if m == nil {
		return Service{}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return Service{}
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 {
		return Service{}
	}
	return svc
}

// envHintsForService inspects on-disk sources; safe to call while holding m.mu.
func (m *Manager) envHintsForService(svc Service) envStackHints {
	if svc.Type != TypeGo {
		return envStackHints{}
	}
	src := filepath.Join(m.serviceDir(svc.Group, svc.Slug), "repo")
	if root := strings.TrimSpace(svc.RootDir); root != "" && root != "." && root != "/" {
		src = filepath.Join(src, filepath.Clean("/"+root)[1:])
	}
	h := detectEnvStackHints(src)
	h.Go = true
	return h
}

func (m *Manager) envHintsFor(group, slug string) envStackHints {
	return m.envHintsForService(m.serviceSnapshot(group, slug))
}
