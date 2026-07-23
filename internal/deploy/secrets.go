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
	body = ensureProductionEnv(body)
	before := body
	body, _ = materializeSecrets(body)
	changed := normalizeEnv(before) != normalizeEnv(body)
	if !changed {
		return body, false
	}
	if persist && strings.TrimSpace(group) != "" && strings.TrimSpace(slug) != "" {
		path := filepath.Join(m.serviceDir(group, slug), "env")
		cur, _ := os.ReadFile(path)
		next := string(cur)
		merged := parseEnvMap(body)
		for _, s := range bootstrapSecretKeys {
			if v := strings.TrimSpace(merged[s.Key]); v != "" && !strings.Contains(v, "${{") {
				next = upsertEnv(next, s.Key, v)
			}
		}
		_ = os.WriteFile(path, []byte(normalizeEnv(next)), 0o600)
	}
	return body, true
}
