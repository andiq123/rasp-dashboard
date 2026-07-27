package deploy

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LinkedEnvBlock is a read-only preview of connection env copied from a sibling at runtime.
type LinkedEnvBlock struct {
	Kind    string `json:"kind"` // database | bucket
	Source  string `json:"source"`
	Label   string `json:"label,omitempty"`
	Env     string `json:"env"`
	EnvJSON string `json:"env_json,omitempty"`
}

// ServiceEnvView is the Variables API payload: this service's own env + optional link previews.
type ServiceEnvView struct {
	Env     string           `json:"env"`
	EnvJSON string           `json:"env_json,omitempty"`
	Linked  []LinkedEnvBlock `json:"linked,omitempty"`
	Kind    string           `json:"kind,omitempty"` // go | postgres | bucket
}

// GetServiceEnv returns this service's own env file and, for Go apps, live link previews
// from group siblings (same values injected at container start — not stored in the Go file).
func (m *Manager) GetServiceEnv(group, slug string) (ServiceEnvView, error) {
	if err := requireSlug(group, "group"); err != nil {
		return ServiceEnvView{}, err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return ServiceEnvView{}, err
	}

	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return ServiceEnvView{}, err
	}
	svc, idx := findService(reg, group, slug)
	m.mu.Unlock()
	if idx < 0 {
		return ServiceEnvView{}, fmt.Errorf("service not found")
	}

	path := filepath.Join(m.serviceDir(group, slug), "env")
	raw, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return ServiceEnvView{}, err
	}
	body := string(raw)

	view := ServiceEnvView{Kind: string(svc.Type)}
	hints := envStackHints{}
	if svc.Type == TypeGo {
		hints = m.envHintsFor(group, slug)
		own := ownEnvBody(body, svc)
		own = sanitizeServiceEnv(own, svc.Type, hints)
		if normalizeEnv(own) != normalizeEnv(body) {
			// Migrate legacy files: strip linked secrets + wrong stack keys.
			_ = os.WriteFile(path, []byte(normalizeEnv(own)), 0o600)
		}
		view.Env = own
		view.EnvJSON = envToJSON(own)
		view.Linked = m.linkedEnvBlocks(svc)
		return view, nil
	}

	clean := sanitizeServiceEnv(body, svc.Type, hints)
	if normalizeEnv(clean) != normalizeEnv(body) {
		_ = os.WriteFile(path, []byte(normalizeEnv(clean)), 0o600)
	}
	view.Env = clean
	view.EnvJSON = envToJSON(clean)
	return view, nil
}

// ownEnvBody keeps only this Go service's variables — linked connection keys are runtime-injected.
func ownEnvBody(body string, svc Service) string {
	if svc.LinkedDatabase != "" {
		body = removeLinkedDBEnv(body)
	}
	if svc.LinkedBucket != "" {
		body = removeLinkedBucketEnv(body)
	}
	return body
}

// linkedEnvBlocks builds read-only previews of sibling connection env for the Variables UI.
func (m *Manager) linkedEnvBlocks(svc Service) []LinkedEnvBlock {
	var out []LinkedEnvBlock
	if db := strings.TrimSpace(svc.LinkedDatabase); db != "" {
		preview := normalizeEnv(m.injectLinkedDatabase("", svc.Group, db))
		if strings.TrimSpace(preview) != "" {
			out = append(out, LinkedEnvBlock{
				Kind:    "database",
				Source:  db,
				Label:   "Database · " + db,
				Env:     preview,
				EnvJSON: envToJSON(preview),
			})
		}
	}
	if bucket := strings.TrimSpace(svc.LinkedBucket); bucket != "" {
		preview := normalizeEnv(m.injectLinkedBucket("", svc.Group, bucket))
		if strings.TrimSpace(preview) != "" {
			out = append(out, LinkedEnvBlock{
				Kind:    "bucket",
				Source:  bucket,
				Label:   "Bucket · " + bucket,
				Env:     preview,
				EnvJSON: envToJSON(preview),
			})
		}
	}
	return out
}
