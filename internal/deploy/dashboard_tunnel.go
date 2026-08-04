package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	dashboardTunnelGroup = "dashboard"
	dashboardTunnelSlug  = "port-8484"
	dashboardPort        = 8484
)

type DashboardTunnelStatus struct {
	Active        bool   `json:"active"`
	Connected     bool   `json:"connected"`
	Verified      bool   `json:"verified"`
	Configured    bool   `json:"configured"`
	Mode          string `json:"mode,omitempty"`
	Hostname      string `json:"hostname,omitempty"`
	PublicURL     string `json:"public_url,omitempty"`
	LocalURL      string `json:"local_url"`
	AuthEnabled   bool   `json:"auth_enabled"`
	AccessGuarded bool   `json:"access_guarded"`
	State         string `json:"state"`
	TunnelID      string `json:"tunnel_id,omitempty"`
	LastError     string `json:"last_error,omitempty"`
}

func (m *Manager) dashboardTunnelPath(name string) string {
	return filepath.Join(m.tunnelDir(dashboardTunnelGroup, dashboardTunnelSlug), name)
}

func dashboardAuthEnabled() bool {
	raw := strings.TrimSpace(os.Getenv("FIREWIFI_AUTH"))
	user, pass, ok := strings.Cut(raw, ":")
	return ok && strings.TrimSpace(user) != "" && pass != ""
}

func (m *Manager) DashboardTunnelStatus() DashboardTunnelStatus {
	connection := m.tunnelConnectionStatus(dashboardTunnelGroup, dashboardTunnelSlug)
	status := DashboardTunnelStatus{
		Active:        connection.Active,
		Connected:     connection.Connected,
		Configured:    m.tunnelWanted(dashboardTunnelGroup, dashboardTunnelSlug),
		PublicURL:     m.readTunnelURL(dashboardTunnelGroup, dashboardTunnelSlug),
		LocalURL:      fmt.Sprintf("http://127.0.0.1:%d", dashboardPort),
		AuthEnabled:   dashboardAuthEnabled(),
		AccessGuarded: fileExists(m.dashboardTunnelPath("access-guarded")),
		Verified:      fileExists(m.dashboardTunnelPath("verified")),
		State:         connection.State,
		TunnelID:      connection.TunnelID,
	}
	if m.hasManagedTunnelToken(dashboardTunnelGroup, dashboardTunnelSlug) {
		status.Mode = "managed"
		status.Hostname = strings.TrimPrefix(strings.TrimSuffix(status.PublicURL, "/"), "https://")
	} else if status.Configured || status.PublicURL != "" {
		status.Mode = "quick"
	}
	if b, err := os.ReadFile(m.dashboardTunnelPath("error")); err == nil {
		status.LastError = strings.TrimSpace(string(b))
	}
	if !status.Active || !status.Connected {
		status.Verified = false
	}
	return status
}

func (m *Manager) StartDashboardTunnel(ctx context.Context, mode, token, hostname string, accessGuarded bool) (DashboardTunnelStatus, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		mode = "managed"
	}
	if mode != "quick" && mode != "managed" {
		return DashboardTunnelStatus{}, fmt.Errorf("tunnel mode must be managed or quick")
	}
	if !dashboardAuthEnabled() && !accessGuarded {
		return DashboardTunnelStatus{}, fmt.Errorf("protect the dashboard with Cloudflare Access or FIREWIFI_AUTH before exposing it")
	}
	if mode == "quick" && !dashboardAuthEnabled() {
		return DashboardTunnelStatus{}, fmt.Errorf("temporary public links require FIREWIFI_AUTH")
	}

	dir := m.tunnelDir(dashboardTunnelGroup, dashboardTunnelSlug)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return DashboardTunnelStatus{}, err
	}
	_ = os.Chmod(dir, 0o700)
	_ = os.Remove(m.dashboardTunnelPath("verified"))
	_ = os.Remove(m.dashboardTunnelPath("error"))
	if accessGuarded {
		_ = os.WriteFile(m.dashboardTunnelPath("access-guarded"), []byte("1\n"), 0o600)
	} else {
		_ = os.Remove(m.dashboardTunnelPath("access-guarded"))
	}

	var public string
	var err error
	logPath := m.dashboardTunnelPath("cloudflared.log")
	if mode == "managed" {
		hostname, err = normalizeTunnelHostname(hostname)
		if err != nil {
			return DashboardTunnelStatus{}, err
		}
		if strings.TrimSpace(token) != "" {
			if err := m.writeManagedTunnelToken(dashboardTunnelGroup, dashboardTunnelSlug, token); err != nil {
				return DashboardTunnelStatus{}, err
			}
		} else if !m.hasManagedTunnelToken(dashboardTunnelGroup, dashboardTunnelSlug) {
			return DashboardTunnelStatus{}, fmt.Errorf("Cloudflare tunnel token required")
		}
		bin, binErr := m.ensureManagedCloudflared(ctx)
		if binErr != nil {
			return DashboardTunnelStatus{}, fmt.Errorf("cloudflared: %w", binErr)
		}
		pid, startErr := m.startManagedTunnel(bin, logPath, m.managedTunnelTokenPath(dashboardTunnelGroup, dashboardTunnelSlug), dashboardTunnelGroup, dashboardTunnelSlug)
		if startErr != nil {
			return DashboardTunnelStatus{}, startErr
		}
		m.writeTunnelPID(dashboardTunnelGroup, dashboardTunnelSlug, pid)
		public = "https://" + hostname
	} else {
		// Switching away from managed mode must not leave a stale token that
		// would make status/bootstrap identify the tunnel incorrectly.
		_ = os.Remove(m.managedTunnelTokenPath(dashboardTunnelGroup, dashboardTunnelSlug))
		bin, binErr := m.EnsureCloudflared(ctx)
		if binErr != nil {
			return DashboardTunnelStatus{}, fmt.Errorf("cloudflared: %w", binErr)
		}
		pid, startErr := m.startQuickTunnel(bin, logPath, fmt.Sprintf("http://127.0.0.1:%d", dashboardPort), dashboardTunnelGroup, dashboardTunnelSlug)
		if startErr != nil {
			return DashboardTunnelStatus{}, startErr
		}
		m.writeTunnelPID(dashboardTunnelGroup, dashboardTunnelSlug, pid)
		deadline := time.Now().Add(45 * time.Second)
		for time.Now().Before(deadline) {
			if ctx.Err() != nil {
				m.StopDashboardTunnel()
				return DashboardTunnelStatus{}, ctx.Err()
			}
			if b, readErr := os.ReadFile(logPath); readErr == nil {
				public = tryCloudflareURL.FindString(string(b))
				if public != "" {
					break
				}
			}
			time.Sleep(250 * time.Millisecond)
		}
		if public == "" {
			m.StopDashboardTunnel()
			return DashboardTunnelStatus{}, fmt.Errorf("tunnel did not publish a URL in time")
		}
	}

	m.writeTunnelWanted(dashboardTunnelGroup, dashboardTunnelSlug, true)
	m.writeTunnelURL(dashboardTunnelGroup, dashboardTunnelSlug, public)
	if err := verifyPublicURL(ctx, public, "/api/health"); err != nil {
		_ = os.WriteFile(m.dashboardTunnelPath("error"), []byte(err.Error()+"\n"), 0o600)
	} else {
		_ = os.WriteFile(m.dashboardTunnelPath("verified"), []byte("1\n"), 0o600)
	}
	return m.DashboardTunnelStatus(), nil
}

func (m *Manager) StopDashboardTunnel() DashboardTunnelStatus {
	m.stopTunnelProcesses(dashboardTunnelGroup, dashboardTunnelSlug)
	_ = os.Remove(m.dashboardTunnelPath("verified"))
	_ = os.Remove(m.dashboardTunnelPath("error"))
	status := m.DashboardTunnelStatus()
	status.Configured = false
	status.PublicURL = ""
	status.Mode = ""
	status.Hostname = ""
	return status
}

// BootstrapDashboardTunnel restores a wanted connector after reboot or a
// dashboard update. Managed hostnames stay stable; quick URLs are recovered
// best-effort and may change when cloudflared itself restarts.
func (m *Manager) BootstrapDashboardTunnel() {
	if m == nil || !m.tunnelWanted(dashboardTunnelGroup, dashboardTunnelSlug) || m.tunnelAlive(dashboardTunnelGroup, dashboardTunnelSlug) {
		return
	}
	status := m.DashboardTunnelStatus()
	ctx, cancel := context.WithTimeout(m.bgCtx, 60*time.Second)
	defer cancel()
	_, err := m.StartDashboardTunnel(ctx, status.Mode, "", status.Hostname, status.AccessGuarded)
	if err != nil {
		_ = os.WriteFile(m.dashboardTunnelPath("error"), []byte(err.Error()+"\n"), 0o600)
		m.logf("warn", "dashboard tunnel restore: %v", err)
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
