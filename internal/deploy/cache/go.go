package cache

import (
	"os"
	"path/filepath"
)

// OpenGoModules resolves the shared Go module cache layer for srcDir.
// Modules are content-addressed inside GOMODCACHE, so one shared store is correct;
// the fingerprint only drives hit/stale messaging and offline-vs-online choice.
func (s *Store) OpenGoModules(group, slug, srcDir string) (Layer, error) {
	if err := s.EnsureRoot(); err != nil {
		return Layer{}, err
	}
	key, err := Fingerprint(KindGoModules, srcDir)
	if err != nil {
		return Layer{}, err
	}
	prev, _ := s.LoadState(group, slug)
	path := filepath.Join(s.Root, "go-modules", "shared")
	layer, err := s.resolve(KindGoModules, key, path, prev.Keys[KindGoModules])
	if err != nil {
		return Layer{}, err
	}
	// Shared store: "Hit" means warm cache on disk, independent of key change.
	layer.Hit = s.dirNonEmpty(path)
	layer.Changed = prev.Keys[KindGoModules] != "" && prev.Keys[KindGoModules] != key
	return layer, nil
}

// GoDockerArgs returns volume mounts and env for a golang build container.
func GoDockerArgs(layer Layer) (vols []string, env []string) {
	buildCache := filepath.Join(filepath.Dir(filepath.Dir(layer.Path)), "go-build")
	_ = os.MkdirAll(buildCache, 0o755)
	vols = []string{
		layer.Path + ":/go/pkg/mod",
		buildCache + ":/tmp/go-build",
	}
	env = []string{
		"GOMODCACHE=/go/pkg/mod",
		"GOCACHE=/tmp/go-build",
		"HOME=/tmp",
		"GOPROXY=https://proxy.golang.org,direct",
	}
	return vols, env
}

// GoCanOffline is true when the module cache is warm and lockfiles did not change.
func GoCanOffline(layer Layer) bool {
	return layer.Hit && !layer.Changed
}
