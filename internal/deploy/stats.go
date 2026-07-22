package deploy

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	statsInterval     = 2 * time.Second
	postgresContainer = "firewifi-postgres"
)

// RuntimeStats is live CPU/RAM usage for a running container.
type RuntimeStats struct {
	CPUPercent float64 `json:"cpu_percent"`
	MemoryMB   float64 `json:"memory_mb"`
	LimitMB    int     `json:"limit_mb,omitempty"`
	LimitCPUs  float64 `json:"limit_cpus,omitempty"`
	PIDs       int     `json:"pids,omitempty"`
	Shared     bool    `json:"shared,omitempty"`
	Source     string  `json:"source,omitempty"` // cgroup|proc
}

type cpuSample struct {
	usageUsec uint64
	at        time.Time
}

type statsHub struct {
	mu     sync.RWMutex
	prev   map[string]cpuSample
	latest map[string]RuntimeStats
}

func newStatsHub() *statsHub {
	return &statsHub{
		prev:   map[string]cpuSample{},
		latest: map[string]RuntimeStats{},
	}
}

// BootstrapStats starts the background sampler for container CPU/RAM.
func (m *Manager) BootstrapStats() {
	if m == nil {
		return
	}
	if m.stats == nil {
		m.stats = newStatsHub()
	}
	go m.statsLoop()
}

func (m *Manager) statsLoop() {
	// Warm first sample so the next tick can compute CPU %.
	m.sampleAllStats(context.Background())
	t := time.NewTicker(statsInterval)
	defer t.Stop()
	for range t.C {
		m.sampleAllStats(context.Background())
	}
}

func (m *Manager) sampleAllStats(ctx context.Context) {
	if m == nil || m.stats == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	type target struct {
		name     string
		limitMB  int
		limitCPU float64
		shared   bool
	}
	seen := map[string]target{}

	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err == nil {
		for _, svc := range reg.Services {
			if svc.Type == TypeGo && svc.Status != "building" {
				name := containerName(svc.Group, svc.Slug)
				seen[name] = target{name: name, limitMB: svc.MemoryMB, limitCPU: svc.CPUs}
			}
			if svc.Type == TypePostgres {
				seen[postgresContainer] = target{
					name: postgresContainer, shared: true,
					limitMB: svc.MemoryMB, limitCPU: svc.CPUs,
				}
			}
		}
	}
	// Always try the shared engine when present.
	if _, ok := seen[postgresContainer]; !ok {
		seen[postgresContainer] = target{name: postgresContainer, shared: true}
	}

	for _, t := range seen {
		st, ok := m.readContainerStats(ctx, t.name)
		if !ok {
			m.stats.mu.Lock()
			delete(m.stats.latest, t.name)
			delete(m.stats.prev, t.name)
			m.stats.mu.Unlock()
			continue
		}
		st.LimitMB = t.limitMB
		st.LimitCPUs = t.limitCPU
		st.Shared = t.shared
		m.stats.mu.Lock()
		m.stats.latest[t.name] = st
		m.stats.mu.Unlock()
	}
}

func (m *Manager) statsForService(svc Service) *RuntimeStats {
	if m == nil || m.stats == nil || !svc.Running {
		return nil
	}
	name := ""
	switch svc.Type {
	case TypeGo:
		name = containerName(svc.Group, svc.Slug)
	case TypePostgres:
		name = postgresContainer
	default:
		return nil
	}
	m.stats.mu.RLock()
	st, ok := m.stats.latest[name]
	m.stats.mu.RUnlock()
	if !ok {
		return nil
	}
	out := st
	if svc.Type == TypeGo {
		out.LimitMB = svc.MemoryMB
		out.LimitCPUs = svc.CPUs
		out.Shared = false
	} else {
		out.Shared = true
	}
	return &out
}

func (m *Manager) readContainerStats(ctx context.Context, name string) (RuntimeStats, bool) {
	pid, err := m.containerPID(ctx, name)
	if err != nil || pid <= 0 {
		return RuntimeStats{}, false
	}
	cg := cgroupPathForPID(pid)
	usage, ok := readCPUUsageUsec(cg)
	memBytes, pids, memSrc := readMemoryBytes(cg, pid)

	now := time.Now()
	st := RuntimeStats{
		MemoryMB: float64(memBytes) / (1024 * 1024),
		PIDs:     pids,
		Source:   memSrc,
	}

	m.stats.mu.Lock()
	prev, hasPrev := m.stats.prev[name]
	m.stats.prev[name] = cpuSample{usageUsec: usage, at: now}
	m.stats.mu.Unlock()

	if hasPrev && ok && usage >= prev.usageUsec {
		wall := now.Sub(prev.at).Seconds()
		if wall > 0.2 {
			deltaSec := float64(usage-prev.usageUsec) / 1e6
			// Percent of a single core (can exceed 100 on multi-threaded apps).
			st.CPUPercent = (deltaSec / wall) * 100
			if n := runtime.NumCPU(); n > 0 && st.CPUPercent > float64(n)*100 {
				st.CPUPercent = float64(n) * 100
			}
			if st.CPUPercent < 0 {
				st.CPUPercent = 0
			}
		}
	}
	return st, true
}

func (m *Manager) containerPID(ctx context.Context, name string) (int, error) {
	out, err := m.dockerQuiet(ctx, "inspect", "-f", "{{.State.Running}} {{.State.Pid}}", name)
	if err != nil {
		return 0, err
	}
	parts := strings.Fields(strings.TrimSpace(out))
	if len(parts) < 2 || parts[0] != "true" {
		return 0, fmt.Errorf("not running")
	}
	pid, err := strconv.Atoi(parts[1])
	if err != nil || pid <= 0 {
		return 0, fmt.Errorf("bad pid")
	}
	return pid, nil
}

func cgroupPathForPID(pid int) string {
	f, err := os.Open(fmt.Sprintf("/proc/%d/cgroup", pid))
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		// v2: 0::/system.slice/docker-….scope
		if i := strings.Index(line, "::"); i >= 0 {
			rel := strings.TrimSpace(line[i+2:])
			if rel == "" {
				return ""
			}
			return filepath.Join("/sys/fs/cgroup", rel)
		}
	}
	return ""
}

func readCPUUsageUsec(cg string) (uint64, bool) {
	if cg == "" {
		return 0, false
	}
	b, err := os.ReadFile(filepath.Join(cg, "cpu.stat"))
	if err != nil {
		return 0, false
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "usage_usec ") {
			n, err := strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(line, "usage_usec ")), 10, 64)
			return n, err == nil
		}
	}
	return 0, false
}

func readMemoryBytes(cg string, mainPID int) (bytes int64, pids int, source string) {
	if cg != "" {
		if b, err := os.ReadFile(filepath.Join(cg, "memory.current")); err == nil {
			if n, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64); err == nil && n > 0 {
				return n, countCgroupPIDs(cg), "cgroup"
			}
		}
		// No memory controller (common on Pi) — sum RSS of processes in the cgroup.
		if list := cgroupPIDs(cg); len(list) > 0 {
			var sum int64
			for _, pid := range list {
				sum += procRSSBytes(pid)
			}
			if sum > 0 {
				return sum, len(list), "proc"
			}
		}
	}
	if rss := procRSSBytes(mainPID); rss > 0 {
		return rss, 1, "proc"
	}
	return 0, 0, ""
}

func countCgroupPIDs(cg string) int {
	return len(cgroupPIDs(cg))
}

func cgroupPIDs(cg string) []int {
	b, err := os.ReadFile(filepath.Join(cg, "cgroup.procs"))
	if err != nil {
		return nil
	}
	var out []int
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		pid, err := strconv.Atoi(line)
		if err == nil && pid > 0 {
			out = append(out, pid)
		}
	}
	return out
}

func procRSSBytes(pid int) int64 {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				return 0
			}
			kb, err := strconv.ParseInt(fields[1], 10, 64)
			if err != nil {
				return 0
			}
			return kb * 1024
		}
	}
	return 0
}

// ListGroupStats returns cached live usage for services in a group (no docker calls).
func (m *Manager) ListGroupStats(group string) map[string]RuntimeStats {
	out := map[string]RuntimeStats{}
	if m == nil || m.stats == nil {
		return out
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return out
	}
	for _, svc := range reg.Services {
		if group != "" && svc.Group != group {
			continue
		}
		if st := m.statsForService(svc); st != nil {
			out[svc.Slug] = *st
		}
	}
	return out
}
