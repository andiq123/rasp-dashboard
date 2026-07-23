package deploy

import (
	"os"
	"path/filepath"
	"strings"
)

// linkedKeyCopy copies one value from a source service env into the app env.
// Prefer is tried first; Fallback is used when Prefer is empty.
type linkedKeyCopy struct {
	App      string
	Prefer   string
	Fallback string
}

// linkedEnvSpec describes a group-scoped link (database, bucket, …).
// Inject always writes concrete values — never ${{service.KEY}} templates.
type linkedEnvSpec struct {
	Kind     string // "database" | "bucket" (logs)
	Remove   []string
	Copy     []linkedKeyCopy
	Literals map[string]string
}

func (m *Manager) readServiceEnvMap(group, slug string) map[string]string {
	group = strings.TrimSpace(group)
	slug = strings.TrimSpace(slug)
	if group == "" || slug == "" {
		return map[string]string{}
	}
	b, err := os.ReadFile(filepath.Join(m.serviceDir(group, slug), "env"))
	if err != nil {
		return map[string]string{}
	}
	return parseEnvMap(string(b))
}

// injectLinkedServiceEnv copies concrete env values from sourceSlug (same group)
// into body. Reserved keys in spec.Remove are cleared first so a re-link is clean.
func (m *Manager) injectLinkedServiceEnv(body, group, sourceSlug string, spec linkedEnvSpec) string {
	return m.injectLinkedServiceEnvFrom(body, group, sourceSlug, m.readServiceEnvMap(group, sourceSlug), spec)
}

// injectLinkedServiceEnvFrom is the shared copy path used by DB + bucket links.
func (m *Manager) injectLinkedServiceEnvFrom(body, group, sourceSlug string, src map[string]string, spec linkedEnvSpec) string {
	sourceSlug = strings.TrimSpace(sourceSlug)
	group = strings.TrimSpace(group)
	if group == "" || sourceSlug == "" {
		return body
	}
	if len(src) == 0 {
		return body
	}

	body = clearEnvKeys(body, spec.Remove...)

	for _, c := range spec.Copy {
		v := envGet(src, c.Prefer)
		if v == "" && c.Fallback != "" {
			v = envGet(src, c.Fallback)
		}
		if v == "" {
			continue
		}
		body = upsertEnv(body, c.App, v)
	}
	for k, v := range spec.Literals {
		if strings.TrimSpace(k) == "" {
			continue
		}
		body = upsertEnv(body, k, v)
	}
	return body
}

// applyClearLinkedBucket clears LinkedBucket and strips injected bucket keys.
func applyClearLinkedBucket(svc Service, envBody string) (Service, string) {
	svc.LinkedBucket = ""
	return svc, removeLinkedBucketEnv(envBody)
}

// applyClearLinkedDatabase clears LinkedDatabase and strips injected DB keys.
func applyClearLinkedDatabase(svc Service, envBody string) (Service, string) {
	svc.LinkedDatabase = ""
	return svc, removeLinkedDBEnv(envBody)
}

// clearLinkedBucketFromService applies applyClearLinkedBucket to the on-disk env file.
func (m *Manager) clearLinkedBucketFromService(svc Service) (Service, error) {
	envPath := filepath.Join(m.serviceDir(svc.Group, svc.Slug), "env")
	cur, err := os.ReadFile(envPath)
	body := ""
	if err == nil {
		body = string(cur)
	} else if !os.IsNotExist(err) {
		return svc, err
	}
	svc, body = applyClearLinkedBucket(svc, body)
	if err := os.WriteFile(envPath, []byte(normalizeEnv(body)), 0o600); err != nil {
		return svc, err
	}
	return svc, nil
}

// clearLinkedDatabaseFromService applies applyClearLinkedDatabase to the on-disk env file.
func (m *Manager) clearLinkedDatabaseFromService(svc Service) (Service, error) {
	envPath := filepath.Join(m.serviceDir(svc.Group, svc.Slug), "env")
	cur, err := os.ReadFile(envPath)
	body := ""
	if err == nil {
		body = string(cur)
	} else if !os.IsNotExist(err) {
		return svc, err
	}
	svc, body = applyClearLinkedDatabase(svc, body)
	if err := os.WriteFile(envPath, []byte(normalizeEnv(body)), 0o600); err != nil {
		return svc, err
	}
	return svc, nil
}
