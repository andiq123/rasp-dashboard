package deploy

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var tryCloudflareURL = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

type tunnelProc struct {
	cmd *exec.Cmd
	url string
}

var (
	tunnelMu    sync.Mutex
	tunnelProcs = map[string]*tunnelProc{}
)

func tunnelKey(group, slug string) string { return group + "/" + slug }

func tunnelUnit(group, slug string) string {
	return "fw-qt-" + group + "-" + slug
}

func (m *Manager) tunnelDir(group, slug string) string {
	return filepath.Join(m.serviceDir(group, slug), "tunnel")
}

func (m *Manager) cloudflaredPath() string {
	if m == nil {
		return "cloudflared"
	}
	return filepath.Join(m.DeployDir, "bin", "cloudflared")
}

// EnsureCloudflared installs a local cloudflared binary if missing.
func (m *Manager) EnsureCloudflared(ctx context.Context) (string, error) {
	bin := m.cloudflaredPath()
	if st, err := os.Stat(bin); err == nil && !st.IsDir() {
		return bin, nil
	}
	if p, err := exec.LookPath("cloudflared"); err == nil {
		return p, nil
	}
	if err := os.MkdirAll(filepath.Dir(bin), 0o755); err != nil {
		return "", err
	}
	arch := runtime.GOARCH
	asset := ""
	switch arch {
	case "arm64", "aarch64":
		asset = "cloudflared-linux-arm64"
	case "amd64", "x86_64":
		asset = "cloudflared-linux-amd64"
	case "arm":
		asset = "cloudflared-linux-arm"
	default:
		return "", fmt.Errorf("unsupported arch %s for cloudflared", arch)
	}
	url := "https://github.com/cloudflare/cloudflared/releases/latest/download/" + asset
	m.logf("info", "Installing cloudflared (%s)", asset)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download cloudflared: HTTP %d", res.StatusCode)
	}
	tmp := bin + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return "", err
	}
	_, err = io.Copy(f, res.Body)
	_ = f.Close()
	if err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	if err := os.Rename(tmp, bin); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return bin, nil
}

func (m *Manager) readTunnelURL(group, slug string) string {
	b, err := os.ReadFile(filepath.Join(m.tunnelDir(group, slug), "url"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func (m *Manager) writeTunnelURL(group, slug, url string) {
	dir := m.tunnelDir(group, slug)
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "url"), []byte(strings.TrimSpace(url)+"\n"), 0o644)
}

func (m *Manager) writeTunnelWanted(group, slug string, on bool) {
	dir := m.tunnelDir(group, slug)
	_ = os.MkdirAll(dir, 0o755)
	path := filepath.Join(dir, "wanted")
	if on {
		_ = os.WriteFile(path, []byte("1\n"), 0o644)
		return
	}
	_ = os.Remove(path)
}

func (m *Manager) tunnelWanted(group, slug string) bool {
	_, err := os.Stat(filepath.Join(m.tunnelDir(group, slug), "wanted"))
	return err == nil
}

func (m *Manager) tunnelPID(group, slug string) int {
	b, err := os.ReadFile(filepath.Join(m.tunnelDir(group, slug), "pid"))
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return n
}

func (m *Manager) writeTunnelPID(group, slug string, pid int) {
	dir := m.tunnelDir(group, slug)
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "pid"), []byte(strconv.Itoa(pid)+"\n"), 0o644)
}

func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

func (m *Manager) systemdTunnelPID(group, slug string) int {
	unit := tunnelUnit(group, slug) + ".service"
	out, err := exec.Command("systemctl", "--user", "show", "-p", "MainPID", "--value", unit).Output()
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(out)))
	return n
}

func (m *Manager) tunnelAlive(group, slug string) bool {
	if pidAlive(m.tunnelPID(group, slug)) {
		return true
	}
	if pid := m.systemdTunnelPID(group, slug); pidAlive(pid) {
		m.writeTunnelPID(group, slug, pid)
		return true
	}
	return false
}

// syncTunnel refreshes PublicURL / TunnelActive from the live quick-tunnel process.
// Prefer keeping the last known URL when the tunnel is wanted — never wipe the
// link during a brief redeploy blip.
func (m *Manager) syncTunnel(svc *Service) {
	if svc == nil || svc.Type != TypeGo {
		return
	}
	alive := m.tunnelAlive(svc.Group, svc.Slug)
	url := m.readTunnelURL(svc.Group, svc.Slug)
	wanted := m.tunnelWanted(svc.Group, svc.Slug)
	if alive {
		svc.TunnelActive = true
		if url != "" {
			svc.PublicURL = url
		} else if svc.PublicURL != "" {
			m.writeTunnelURL(svc.Group, svc.Slug, svc.PublicURL)
		}
		return
	}
	if wanted && url != "" {
		// Process briefly missing — keep showing the same link while heal runs.
		svc.TunnelActive = false
		svc.PublicURL = url
		return
	}
	if !alive && !wanted {
		stale := svc.TunnelActive || svc.PublicURL != "" || url != ""
		svc.TunnelActive = false
		svc.PublicURL = ""
		if url != "" || m.tunnelPID(svc.Group, svc.Slug) > 0 {
			_ = os.Remove(filepath.Join(m.tunnelDir(svc.Group, svc.Slug), "url"))
			_ = os.Remove(filepath.Join(m.tunnelDir(svc.Group, svc.Slug), "pid"))
		}
		if stale {
			svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			m.persistService(*svc)
		}
	}
}

func (m *Manager) tunnelUnitPath(group, slug string) string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "systemd", "user", tunnelUnit(group, slug)+".service")
}

func (m *Manager) stopSystemdTunnel(group, slug string) {
	unit := tunnelUnit(group, slug) + ".service"
	_ = exec.Command("systemctl", "--user", "stop", unit).Run()
	_ = exec.Command("systemctl", "--user", "disable", unit).Run()
	_ = exec.Command("systemctl", "--user", "reset-failed", unit).Run()
	_ = os.Remove(m.tunnelUnitPath(group, slug))
	_ = exec.Command("systemctl", "--user", "daemon-reload").Run()
}

// startQuickTunnel runs cloudflared in its own user systemd unit so it survives
// dashboard rebuilds/restarts. Restart=no keeps the same trycloudflare URL until
// the process dies (reboot / Unexpose / crash).
func (m *Manager) startQuickTunnel(bin, logPath, local, group, slug string) (int, error) {
	_ = os.WriteFile(logPath, nil, 0o644)
	m.stopSystemdTunnel(group, slug)

	unitPath := m.tunnelUnitPath(group, slug)
	if err := os.MkdirAll(filepath.Dir(unitPath), 0o755); err != nil {
		return 0, err
	}
	body := fmt.Sprintf(`[Unit]
Description=FireWifi quick tunnel %s/%s
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s tunnel --no-autoupdate --url %s
Restart=no
Environment=NO_AUTOUPDATE=1
StandardOutput=append:%s
StandardError=append:%s

[Install]
WantedBy=default.target
`, group, slug, bin, local, logPath, logPath)
	if err := os.WriteFile(unitPath, []byte(body), 0o644); err != nil {
		return 0, err
	}
	unit := tunnelUnit(group, slug) + ".service"
	_ = exec.Command("systemctl", "--user", "daemon-reload").Run()
	if err := exec.Command("systemctl", "--user", "enable", "--now", unit).Run(); err != nil {
		return 0, fmt.Errorf("start %s: %w", unit, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		pid := m.systemdTunnelPID(group, slug)
		if pidAlive(pid) {
			return pid, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return 0, fmt.Errorf("quick tunnel started but no MainPID yet")
}

// StartTunnel exposes a running Go app on a random trycloudflare.com URL.
func (m *Manager) StartTunnel(ctx context.Context, group, slug string) (Service, error) {
	if err := requireSlug(group, "group"); err != nil {
		return Service{}, err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return Service{}, err
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return Service{}, err
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 || svc.Type != TypeGo {
		return Service{}, fmt.Errorf("go service not found")
	}
	svc = m.refreshStatus(ctx, svc)
	if !svc.Running || svc.Port <= 0 {
		return Service{}, fmt.Errorf("start the app before exposing it")
	}
	if m.tunnelAlive(group, slug) {
		m.syncTunnel(&svc)
		if svc.PublicURL != "" {
			m.writeTunnelWanted(group, slug, true)
			return svc, nil
		}
	}

	bin, err := m.EnsureCloudflared(ctx)
	if err != nil {
		return Service{}, fmt.Errorf("cloudflared: %w", err)
	}
	dir := m.tunnelDir(group, slug)
	_ = os.MkdirAll(dir, 0o755)
	logPath := filepath.Join(dir, "cloudflared.log")
	local := fmt.Sprintf("http://127.0.0.1:%d", svc.Port)

	pid, err := m.startQuickTunnel(bin, logPath, local, group, slug)
	if err != nil {
		return Service{}, fmt.Errorf("start cloudflared: %w", err)
	}
	m.writeTunnelPID(group, slug, pid)
	m.writeTunnelWanted(group, slug, true)

	var public string
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			_, _ = m.StopTunnel(context.Background(), group, slug)
			return Service{}, ctx.Err()
		}
		if b, err := os.ReadFile(logPath); err == nil {
			public = tryCloudflareURL.FindString(string(b))
			if public != "" {
				break
			}
		}
		if !m.tunnelAlive(group, slug) {
			break
		}
		select {
		case <-ctx.Done():
			_, _ = m.StopTunnel(context.Background(), group, slug)
			return Service{}, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	if public == "" {
		_, _ = m.StopTunnel(context.Background(), group, slug)
		return Service{}, fmt.Errorf("tunnel did not publish a URL in time — check cloudflared.log")
	}
	m.writeTunnelURL(group, slug, public)

	svc.PublicURL = public
	svc.TunnelActive = true
	svc.StaticHost = ""
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.persistService(svc)
	m.logf("ok", "Exposed %s/%s → %s", group, slug, public)
	return svc, nil
}

// StopTunnel tears down the quick tunnel for a service.
func (m *Manager) StopTunnel(ctx context.Context, group, slug string) (Service, error) {
	_ = ctx
	if err := requireSlug(group, "group"); err != nil {
		return Service{}, err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return Service{}, err
	}
	key := tunnelKey(group, slug)
	tunnelMu.Lock()
	tp := tunnelProcs[key]
	delete(tunnelProcs, key)
	tunnelMu.Unlock()
	if tp != nil && tp.cmd != nil && tp.cmd.Process != nil {
		_ = syscall.Kill(-tp.cmd.Process.Pid, syscall.SIGTERM)
		_ = tp.cmd.Process.Kill()
	}
	m.stopSystemdTunnel(group, slug)
	if pid := m.tunnelPID(group, slug); pid > 0 {
		_ = syscall.Kill(-pid, syscall.SIGTERM)
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Kill()
		}
	}
	dir := m.tunnelDir(group, slug)
	_ = os.Remove(filepath.Join(dir, "pid"))
	_ = os.Remove(filepath.Join(dir, "url"))
	m.writeTunnelWanted(group, slug, false)

	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return Service{}, err
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 {
		return Service{}, fmt.Errorf("service not found")
	}
	svc.PublicURL = ""
	svc.TunnelActive = false
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.persistService(svc)
	m.logf("info", "Tunnel closed for %s/%s", group, slug)
	return svc, nil
}


// BootstrapQuickTunnels re-exposes apps marked wanted after reboot (new random URL).
func (m *Manager) BootstrapQuickTunnels() {
	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return
	}
	for _, svc := range reg.Services {
		if svc.Type != TypeGo || !m.tunnelWanted(svc.Group, svc.Slug) {
			continue
		}
		if m.tunnelAlive(svc.Group, svc.Slug) {
			go func(group, slug string) {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				if _, err := m.EnsureTunnel(ctx, group, slug); err != nil {
					m.logf("warn", "Tunnel heal %s/%s: %v", group, slug, err)
				}
			}(svc.Group, svc.Slug)
			continue
		}
		go func(group, slug string) {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			if _, err := m.StartTunnel(ctx, group, slug); err != nil {
				m.logf("warn", "auto-expose %s/%s: %v", group, slug, err)
			}
		}(svc.Group, svc.Slug)
	}
}
