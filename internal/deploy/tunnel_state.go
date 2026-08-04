package deploy

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const tunnelLogTailBytes int64 = 128 * 1024

var cloudflareConfigHostnamePattern = regexp.MustCompile(`hostname\\?":\\?"([^"\\]+)`)
var cloudflareConnIndexPattern = regexp.MustCompile(`connIndex=([0-9]+)`)

type tunnelConnectionStatus struct {
	Active    bool
	State     string
	Connected bool
	TunnelID  string
}

func readFileTail(path string, limit int64) ([]byte, os.FileInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, nil, err
	}
	start := info.Size() - limit
	if start < 0 {
		start = 0
	}
	if _, err := f.Seek(start, 0); err != nil {
		return nil, nil, err
	}
	b, err := io.ReadAll(io.LimitReader(f, limit))
	return b, info, err
}

func (m *Manager) tunnelConnectionStatus(group, slug string) tunnelConnectionStatus {
	return m.tunnelConnectionStatusForProcess(group, slug, m.tunnelAlive(group, slug))
}

func (m *Manager) tunnelConnectionStatusForProcess(group, slug string, active bool) tunnelConnectionStatus {
	if !active {
		return tunnelConnectionStatus{State: "inactive", TunnelID: m.managedTunnelID(group, slug)}
	}
	if !m.hasManagedTunnelToken(group, slug) {
		connected := m.readTunnelURL(group, slug) != ""
		state := "starting"
		if connected {
			state = "connected"
		}
		return tunnelConnectionStatus{Active: true, State: state, Connected: connected}
	}

	tokenID := m.managedTunnelID(group, slug)
	b, info, err := readFileTail(filepath.Join(m.tunnelDir(group, slug), "cloudflared.log"), tunnelLogTailBytes)
	if err != nil {
		return tunnelConnectionStatus{Active: true, State: "starting", TunnelID: tokenID}
	}
	text := string(b)
	start := strings.LastIndex(text, "Starting tunnel tunnelID=")
	if start >= 0 {
		current := text[start:]
		if tokenID != "" && !strings.Contains(current, "Starting tunnel tunnelID="+tokenID) {
			return tunnelConnectionStatus{Active: true, State: "misconfigured", TunnelID: tokenID}
		}
		if config := strings.LastIndex(current, "Updated to new configuration"); config >= 0 {
			match := cloudflareConfigHostnamePattern.FindStringSubmatch(current[config:])
			expected := strings.TrimPrefix(strings.TrimSuffix(m.readTunnelURL(group, slug), "/"), "https://")
			if expected != "" && (len(match) < 2 || !strings.EqualFold(match[1], expected)) {
				return tunnelConnectionStatus{Active: true, State: "misconfigured", TunnelID: tokenID}
			}
		}
		connections := map[string]bool{}
		registered := false
		for _, line := range strings.Split(current, "\n") {
			match := cloudflareConnIndexPattern.FindStringSubmatch(line)
			if len(match) < 2 {
				continue
			}
			switch {
			case strings.Contains(line, "Registered tunnel connection"):
				registered = true
				connections[match[1]] = true
			case strings.Contains(line, "Unregistered tunnel connection"),
				strings.Contains(line, "Failed to serve tunnel connection"),
				strings.Contains(line, "connection terminated"):
				connections[match[1]] = false
			}
		}
		for _, connected := range connections {
			if connected {
				return tunnelConnectionStatus{Active: true, State: "connected", Connected: true, TunnelID: tokenID}
			}
		}
		if registered {
			state := "starting"
			if time.Since(info.ModTime()) >= 20*time.Second {
				state = "disconnected"
			}
			return tunnelConnectionStatus{Active: true, State: state, TunnelID: tokenID}
		}
	}
	if time.Since(info.ModTime()) < 20*time.Second {
		return tunnelConnectionStatus{Active: true, State: "starting", TunnelID: tokenID}
	}
	return tunnelConnectionStatus{Active: true, State: "disconnected", TunnelID: tokenID}
}

func (m *Manager) BootstrapTunnelVerification() {
	m.refreshPendingTunnelVerification()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.bgDone():
			return
		case <-ticker.C:
			m.refreshPendingTunnelVerification()
		}
	}
}

func (m *Manager) refreshPendingTunnelVerification() {
	ctx, cancel := context.WithTimeout(m.bgCtx, 6*time.Second)
	defer cancel()

	status := m.DashboardTunnelStatus()
	if status.Configured && status.Connected && !status.Verified && status.PublicURL != "" {
		if err := verifyPublicURL(ctx, status.PublicURL, "/api/health"); err == nil {
			_ = os.WriteFile(m.dashboardTunnelPath("verified"), []byte("1\n"), 0o600)
			_ = os.Remove(m.dashboardTunnelPath("error"))
		} else {
			_ = os.WriteFile(m.dashboardTunnelPath("error"), []byte(err.Error()+"\n"), 0o600)
		}
	}

	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return
	}
	for i := range reg.Services {
		svc := reg.Services[i]
		if svc.Type != TypeGo || svc.TunnelVerified || strings.TrimSpace(svc.PublicURL) == "" {
			continue
		}
		connection := m.tunnelConnectionStatus(svc.Group, svc.Slug)
		if !connection.Connected {
			continue
		}
		if err := verifyPublicURL(ctx, svc.PublicURL, svc.PublicPath); err == nil {
			svc.TunnelVerified = true
			m.persistService(svc)
		}
		if ctx.Err() != nil {
			break
		}
	}
}
