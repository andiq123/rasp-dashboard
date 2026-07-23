package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// EnsureTunnel restores or keeps a quick tunnel after deploy/reboot.
//
// Policy (trycloudflare):
//  1. Prefer reuse — never restart cloudflared when process + origin port match.
//  2. Restore PublicURL from the on-disk url file / cloudflared log.
//  3. Restart only when the process is dead or the unit origin port drifted
//     (restart yields a new random hostname — unavoidable for quick tunnels).
func (m *Manager) EnsureTunnel(ctx context.Context, group, slug string) (Service, error) {
	svc, err := m.loadGoService(group, slug)
	if err != nil {
		return Service{}, err
	}
	if !m.tunnelDesired(svc) {
		return svc, nil
	}
	m.writeTunnelWanted(group, slug, true)

	if err := m.waitOrigin(ctx, svc.Port, 20*time.Second); err != nil && ctx.Err() != nil {
		return svc, ctx.Err()
	}

	alive := m.tunnelAlive(group, slug)
	public := m.knownPublicURL(svc)
	unitOrigin := m.tunnelUnitLocalURL(group, slug)
	wantOrigin := localOriginURL(svc.Port)

	switch {
	case alive && originsMatch(unitOrigin, wantOrigin):
		return m.keepTunnel(svc, public)

	case alive && unitOrigin != "" && wantOrigin != "" && unitOrigin != wantOrigin:
		m.logf("warn", "Tunnel origin moved %s → %s — re-exposing (new link)", unitOrigin, wantOrigin)
		return m.recreateTunnel(ctx, group, slug, svc)

	case !alive:
		m.logf("info", "Tunnel process down for %s/%s — re-exposing", group, slug)
		return m.recreateTunnel(ctx, group, slug, svc)
	}

	m.syncTunnel(&svc)
	m.persistService(svc)
	return svc, nil
}

// HealTunnelAfterDeploy is kept as a compatibility alias for EnsureTunnel.
func (m *Manager) HealTunnelAfterDeploy(ctx context.Context, group, slug string) Service {
	svc, err := m.EnsureTunnel(ctx, group, slug)
	if err != nil {
		m.logf("warn", "Tunnel heal %s/%s: %v", group, slug, err)
	}
	return svc
}

func (m *Manager) loadGoService(group, slug string) (Service, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return Service{}, err
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 || svc.Type != TypeGo {
		return Service{}, fmt.Errorf("go service not found")
	}
	return svc, nil
}

func (m *Manager) tunnelDesired(svc Service) bool {
	if m.tunnelWanted(svc.Group, svc.Slug) {
		return true
	}
	if svc.TunnelActive || strings.TrimSpace(svc.PublicURL) != "" {
		return true
	}
	return m.readTunnelURL(svc.Group, svc.Slug) != ""
}

func (m *Manager) knownPublicURL(svc Service) string {
	if u := m.readTunnelURL(svc.Group, svc.Slug); u != "" {
		return u
	}
	if u := strings.TrimSpace(svc.PublicURL); u != "" {
		return u
	}
	return m.publicURLFromLog(svc.Group, svc.Slug)
}

func (m *Manager) publicURLFromLog(group, slug string) string {
	b, err := os.ReadFile(filepath.Join(m.tunnelDir(group, slug), "cloudflared.log"))
	if err != nil {
		return ""
	}
	return tryCloudflareURL.FindString(string(b))
}

func (m *Manager) waitOrigin(ctx context.Context, port int, budget time.Duration) error {
	if port <= 0 {
		return nil
	}
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if m.portOpen(port) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return fmt.Errorf("origin :%d not open", port)
}

func originsMatch(unitOrigin, wantOrigin string) bool {
	if wantOrigin == "" {
		return true
	}
	return unitOrigin == "" || unitOrigin == wantOrigin
}

func (m *Manager) keepTunnel(svc Service, public string) (Service, error) {
	if public == "" {
		m.syncTunnel(&svc)
		m.persistService(svc)
		return svc, nil
	}
	m.writeTunnelURL(svc.Group, svc.Slug, public)
	svc.PublicURL = public
	svc.TunnelActive = true
	m.restorePublicPath(&svc)
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.persistService(svc)
	m.logf("ok", "Tunnel kept %s/%s → %s", svc.Group, svc.Slug, publicOpenURL(public, svc.PublicPath))
	return svc, nil
}

func (m *Manager) recreateTunnel(ctx context.Context, group, slug string, prev Service) (Service, error) {
	if m.tunnelAlive(group, slug) {
		_, _ = m.StopTunnel(ctx, group, slug)
	}
	m.writeTunnelWanted(group, slug, true)
	out, err := m.StartTunnel(ctx, group, slug)
	if err != nil {
		return prev, err
	}
	return out, nil
}

// tunnelUnitLocalURL returns the origin URL embedded in the systemd unit.
func (m *Manager) tunnelUnitLocalURL(group, slug string) string {
	b, err := os.ReadFile(m.tunnelUnitPath(group, slug))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "ExecStart=") || !strings.Contains(line, "--url ") {
			continue
		}
		parts := strings.Split(line, "--url ")
		if len(parts) < 2 {
			continue
		}
		return strings.TrimSpace(parts[len(parts)-1])
	}
	return ""
}
