package cache

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Kind identifies a reusable build layer.
type Kind string

const (
	// KindGoModules is the shared Go module download cache (GOMODCACHE).
	KindGoModules Kind = "go-modules"
	// KindNPMCache is npm's content-addressed download cache (_cacache).
	KindNPMCache Kind = "npm-cache"
	// KindNPMModules is a lockfile-keyed node_modules snapshot.
	KindNPMModules Kind = "npm-modules"
)

// Store is the on-disk cache root:
//
//	<DeployDir>/cache/
//	  go-modules/shared/          # GOMODCACHE
//	  npm-cache/shared/           # npm_config_cache
//	  npm-modules/<lockHash>/     # restored node_modules trees
//	  state/<group>/<slug>.json   # last fingerprints per service
type Store struct {
	Root string
}

func New(deployDir string) *Store {
	return &Store{Root: filepath.Join(deployDir, "cache")}
}

// Layer is one resolved cache directory for a build step.
type Layer struct {
	Kind    Kind   `json:"kind"`
	Key     string `json:"key"`
	Path    string `json:"path"`
	Hit     bool   `json:"hit"`     // layer dir exists and looks populated
	Changed bool   `json:"changed"` // fingerprint differs from last deploy for this service
}

// ServiceState remembers the last dependency fingerprints used for a service.
type ServiceState struct {
	Group     string          `json:"group"`
	Slug      string          `json:"slug"`
	Keys      map[Kind]string `json:"keys"`
	UpdatedAt string          `json:"updated_at"`
}

func (s *Store) EnsureRoot() error {
	return os.MkdirAll(s.Root, 0o755)
}

func (s *Store) statePath(group, slug string) string {
	return filepath.Join(s.Root, "state", group, slug+".json")
}

func (s *Store) LoadState(group, slug string) (ServiceState, error) {
	var st ServiceState
	b, err := os.ReadFile(s.statePath(group, slug))
	if err != nil {
		if os.IsNotExist(err) {
			return ServiceState{Group: group, Slug: slug, Keys: map[Kind]string{}}, nil
		}
		return st, err
	}
	if err := json.Unmarshal(b, &st); err != nil {
		return ServiceState{Group: group, Slug: slug, Keys: map[Kind]string{}}, nil
	}
	if st.Keys == nil {
		st.Keys = map[Kind]string{}
	}
	return st, nil
}

func (s *Store) SaveState(group, slug string, keys map[Kind]string) error {
	path := s.statePath(group, slug)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	st := ServiceState{
		Group:     group,
		Slug:      slug,
		Keys:      keys,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) dirNonEmpty(path string) bool {
	ents, err := os.ReadDir(path)
	return err == nil && len(ents) > 0
}

func (s *Store) resolve(kind Kind, key, path string, prev string) (Layer, error) {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return Layer{}, err
	}
	hit := s.dirNonEmpty(path)
	changed := prev != "" && prev != key
	if prev == "" {
		changed = !hit // first seen: treat empty as needing populate
	}
	return Layer{Kind: kind, Key: key, Path: path, Hit: hit, Changed: changed || (prev != "" && prev != key)}, nil
}

func shortKey(key string) string {
	if len(key) > 12 {
		return key[:12]
	}
	return key
}

func (l Layer) Summary() string {
	state := "miss"
	if l.Hit && !l.Changed {
		state = "hit"
	} else if l.Hit && l.Changed {
		state = "stale→refresh"
	}
	return fmt.Sprintf("%s %s (%s)", l.Kind, state, shortKey(l.Key))
}


// ForgetService drops per-service fingerprint state (not shared module cache).
func (s *Store) ForgetService(group, slug string) {
	if s == nil {
		return
	}
	_ = os.Remove(s.statePath(group, slug))
}

// ForgetGroup drops all fingerprint state for a group.
func (s *Store) ForgetGroup(group string) {
	if s == nil {
		return
	}
	_ = os.RemoveAll(filepath.Join(s.Root, "state", group))
}
