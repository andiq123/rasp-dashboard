package cache

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// OpenNPM resolves npm download cache + lockfile-keyed node_modules layer.
func (s *Store) OpenNPM(group, slug, srcDir string) (download Layer, modules Layer, err error) {
	if err = s.EnsureRoot(); err != nil {
		return
	}
	key, err := Fingerprint(KindNPMModules, srcDir)
	if err != nil {
		return
	}
	prev, _ := s.LoadState(group, slug)

	dlPath := filepath.Join(s.Root, "npm-cache", "shared")
	download, err = s.resolve(KindNPMCache, key, dlPath, prev.Keys[KindNPMCache])
	if err != nil {
		return
	}
	download.Hit = s.dirNonEmpty(dlPath)
	download.Changed = prev.Keys[KindNPMCache] != "" && prev.Keys[KindNPMCache] != key

	modPath := filepath.Join(s.Root, "npm-modules", key)
	modules, err = s.resolve(KindNPMModules, key, modPath, prev.Keys[KindNPMModules])
	if err != nil {
		return
	}
	modules.Hit = s.dirNonEmpty(filepath.Join(modPath, "node_modules"))
	modules.Changed = prev.Keys[KindNPMModules] != "" && prev.Keys[KindNPMModules] != key
	return download, modules, nil
}

// NPMCacheMount returns the docker -v and env for the shared npm download cache.
func NPMCacheMount(download Layer) (vol string, env []string) {
	return download.Path + ":/npm-cache", []string{
		"npm_config_cache=/npm-cache",
		"NODE_ENV=production",
	}
}

// PrepareNPMModules restores a warm node_modules snapshot into destDir when the layer hits.
func (s *Store) PrepareNPMModules(modules Layer, destDir string) (restored bool, err error) {
	src := filepath.Join(modules.Path, "node_modules")
	dst := filepath.Join(destDir, "node_modules")
	if !(modules.Hit && !modules.Changed) {
		return false, nil
	}
	if !s.dirNonEmpty(src) {
		return false, nil
	}
	_ = os.RemoveAll(dst)
	if err := copyDir(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return false, fmt.Errorf("restore node_modules: %w", err)
	}
	return true, nil
}

// CommitNPMModules snapshots destDir/node_modules into the lockfile-keyed layer after npm ci.
func (s *Store) CommitNPMModules(modules Layer, srcDir string) error {
	src := filepath.Join(srcDir, "node_modules")
	if !s.dirNonEmpty(src) {
		return fmt.Errorf("npm-modules: nothing to commit")
	}
	tmp := modules.Path + ".tmp"
	_ = os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		return err
	}
	if err := copyDir(src, filepath.Join(tmp, "node_modules")); err != nil {
		_ = os.RemoveAll(tmp)
		return err
	}
	_ = os.RemoveAll(modules.Path)
	if err := os.Rename(tmp, modules.Path); err != nil {
		return err
	}
	return nil
}

// NPMInstallShell returns a bash snippet that reuses restored modules or runs npm ci.
func NPMInstallShell(restored bool) string {
	// Production install only — no devDependencies.
	ci := "NODE_ENV=production npm ci --omit=dev --cache /npm-cache --prefer-offline"
	if restored {
		return `if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then ` + ci + `; fi`
	}
	return ci
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			_ = os.Remove(target)
			return os.Symlink(link, target)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, in)
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
}
