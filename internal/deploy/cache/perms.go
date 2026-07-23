package cache

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// EnsureWritable makes sure the dashboard user can create files under each path.
// Older docker builds ran as root and left GOMODCACHE / GOCACHE root-owned, which
// breaks later builds that run with --user $(id -u).
func EnsureWritable(paths ...string) error {
	uid := os.Getuid()
	gid := os.Getgid()
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		if err := os.MkdirAll(path, 0o755); err != nil {
			return err
		}
		if cacheOwnedBy(path, uid) && probeWritable(path) {
			continue
		}
		if err := chownTree(path, uid, gid); err != nil {
			return fmt.Errorf("cache not writable at %s — run: sudo chown -R %d:%d %s (%w)", path, uid, gid, path, err)
		}
		if !probeWritable(path) {
			return fmt.Errorf("cache still not writable at %s after chown", path)
		}
	}
	return nil
}

func probeWritable(path string) bool {
	// Go writes under cache/download — probe the same tree.
	dir := filepath.Join(path, "cache", "download")
	_ = os.MkdirAll(dir, 0o755)
	probe := filepath.Join(dir, ".fw-write-probe")
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		// Fallback: top-level probe (empty brand-new cache).
		probe = filepath.Join(path, ".fw-write-probe")
		if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
			return false
		}
	}
	_ = os.Remove(probe)
	return true
}

func cacheOwnedBy(root string, uid int) bool {
	ok := true
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !ok {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		st, okStat := info.Sys().(*syscall.Stat_t)
		if !okStat {
			return nil
		}
		if int(st.Uid) != uid {
			ok = false
			return fs.SkipAll
		}
		return nil
	})
	return ok
}

func chownTree(path string, uid, gid int) error {
	// Prefer passwordless sudo (same pattern as docker inspect on the Pi).
	cmd := exec.Command("sudo", "-n", "chown", "-R", strconv.Itoa(uid)+":"+strconv.Itoa(gid), path)
	if out, err := cmd.CombinedOutput(); err == nil {
		return nil
	} else if len(out) > 0 {
		// Fall through to a root docker chown if sudo is unavailable.
		_ = out
	}
	// Last resort: ephemeral root container on the same bind mount.
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	who := strconv.Itoa(uid) + ":" + strconv.Itoa(gid)
	cmd = exec.Command("docker", "run", "--rm",
		"-v", abs+":/cache",
		"golang:bookworm",
		"chown", "-R", who, "/cache",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
