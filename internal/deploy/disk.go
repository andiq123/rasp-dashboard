package deploy

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DiskBreakdown is on-disk usage for one service directory.
type DiskBreakdown struct {
	TotalBytes  int64 `json:"total_bytes"`
	CloneBytes  int64 `json:"clone_bytes"`
	BinaryBytes int64 `json:"binary_bytes"`
	OtherBytes  int64 `json:"other_bytes"`
	HasClone    bool  `json:"has_clone"`
	HasBinary   bool  `json:"has_binary"`
}

func dirSize(root string) int64 {
	var total int64
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		total += info.Size()
		return nil
	})
	return total
}

func fmtBytes(n int64) string {
	if n < 1024 {
		return fmt.Sprintf("%d B", n)
	}
	if n < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(n)/1024)
	}
	if n < 1024*1024*1024 {
		return fmt.Sprintf("%.1f MB", float64(n)/(1024*1024))
	}
	return fmt.Sprintf("%.2f GB", float64(n)/(1024*1024*1024))
}

func (m *Manager) serviceDisk(group, slug string) DiskBreakdown {
	dir := m.serviceDir(group, slug)
	repo := filepath.Join(dir, "repo")
	out := filepath.Join(dir, "out")
	clone := dirSize(repo)
	if st, e := os.Stat(repo); e != nil || !st.IsDir() {
		clone = 0
	}
	appPath := filepath.Join(out, "app")
	hasApp := false
	if st, e := os.Stat(appPath); e == nil && st.Mode().IsRegular() {
		hasApp = true
	}
	binBytes := int64(0)
	if hasApp {
		binBytes = dirSize(out)
	} else if st, e := os.Stat(filepath.Join(out, "builds")); e == nil && st.IsDir() {
		binBytes = dirSize(filepath.Join(out, "builds"))
	}
	total := dirSize(dir)
	other := total - clone - binBytes
	if other < 0 {
		other = 0
	}
	return DiskBreakdown{
		TotalBytes:  total,
		CloneBytes:  clone,
		BinaryBytes: binBytes,
		OtherBytes:  other,
		HasClone:    clone > 0,
		HasBinary:   hasApp || binBytes > 0,
	}
}

func (m *Manager) applyDisk(svc *Service) {
	d := m.serviceDisk(svc.Group, svc.Slug)
	svc.DiskBytes = d.TotalBytes
	svc.CloneBytes = d.CloneBytes
	svc.BinaryBytes = d.BinaryBytes
	svc.HasClone = d.HasClone
}

func (m *Manager) logCloneRetained(group, slug string, cause error) {
	d := m.serviceDisk(group, slug)
	path := filepath.Join(m.serviceDir(group, slug), "repo")
	label := "Deploy failed"
	if cause != nil {
		c := strings.ToLower(cause.Error())
		if strings.Contains(c, "build:") || strings.Contains(c, "modules:") {
			label = "Build failed"
		} else if strings.Contains(c, "promote:") {
			label = "Promote failed"
		} else if strings.Contains(c, "start:") {
			label = "Start failed"
		}
	}
	m.logf("warn", "%s — source clone kept on disk", label)
	m.logf("info", "Clone %s at %s", fmtBytes(d.CloneBytes), path)
	if d.BinaryBytes > 0 {
		m.logf("info", "Artifacts on disk %s", fmtBytes(d.BinaryBytes))
	}
	m.logf("info", "Redeploy reuses this clone · Delete frees %s", fmtBytes(d.TotalBytes))
	if cause != nil {
		msg := strings.TrimSpace(cause.Error())
		if len(msg) > 240 {
			msg = msg[:240] + "…"
		}
		m.logf("err", "%s", msg)
	}
}

func classifyDeployErr(err error, svc Service) string {
	if err == nil {
		return "Deploy failed"
	}
	msg := err.Error()
	prefix := "Deploy failed"
	low := strings.ToLower(msg)
	if strings.Contains(low, "cancel") {
		return "Build cancelled"
	}
	if strings.Contains(low, "build:") || strings.Contains(low, "modules:") {
		prefix = "Build failed"
	} else if strings.Contains(low, "promote:") {
		prefix = "Promote failed"
	} else if strings.Contains(low, "start:") {
		prefix = "Start failed"
	}
	if svc.HasClone || svc.CloneBytes > 0 {
		return fmt.Sprintf("%s · clone kept (%s) — Redeploy or Delete", prefix, fmtBytes(svc.CloneBytes))
	}
	if svc.DiskBytes > 0 {
		return fmt.Sprintf("%s · %s on disk — Delete to free", prefix, fmtBytes(svc.DiskBytes))
	}
	return prefix + " · " + msg
}

func (m *Manager) logRemovePath(label, path string) int64 {
	n := dirSize(path)
	if _, err := os.Stat(path); err != nil {
		m.logf("info", "Skip %s (already gone)", label)
		return 0
	}
	if n > 0 {
		m.logf("info", "Removing %s · freeing %s", label, fmtBytes(n))
	} else {
		m.logf("info", "Removing %s", label)
	}
	_ = os.RemoveAll(path)
	return n
}
