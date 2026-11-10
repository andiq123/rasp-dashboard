package deploy

import (
	"testing"
	"time"
)

func seedService(t *testing.T, m *Manager, svc Service) {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		t.Fatal(err)
	}
	reg.Services = append(reg.Services, svc)
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}
}

func storedService(t *testing.T, m *Manager, group, slug string) Service {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		t.Fatal(err)
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 {
		t.Fatalf("service %s/%s missing", group, slug)
	}
	return svc
}

// A tunnel probe or start/stop holds a Service read earlier. Writing it back
// must not revert settings saved in the meantime.
func TestScopedPersistKeepsConcurrentSettings(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()
	seedService(t, m, Service{Group: "g", Slug: "api", Type: TypeGo, Name: "api", Branch: "main", MemoryMB: 256, Status: "stopped"})

	stale := storedService(t, m, "g", "api")

	// Operator saves settings while the slow operation is still running.
	if err := m.updateService("g", "api", func(cur *Service) {
		cur.Branch = "release"
		cur.MemoryMB = 512
	}); err != nil {
		t.Fatal(err)
	}

	stale.Running = true
	stale.Status = "running"
	m.persistRunState(stale)

	stale.PublicURL = "https://example.trycloudflare.com"
	stale.TunnelActive = true
	stale.TunnelState = "connected"
	if err := m.persistTunnelState(stale); err != nil {
		t.Fatal(err)
	}

	got := storedService(t, m, "g", "api")
	if got.Branch != "release" || got.MemoryMB != 512 {
		t.Fatalf("settings reverted by a stale write: branch=%q memory=%d", got.Branch, got.MemoryMB)
	}
	if !got.Running || got.Status != "running" || got.PublicURL == "" || !got.TunnelActive {
		t.Fatalf("scoped fields not stored: %+v", got)
	}
}

// A tunnel that went away must actually lose its stored URL.
func TestPersistTunnelStateClearsURL(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()
	seedService(t, m, Service{Group: "g", Slug: "api", Type: TypeGo, PublicURL: "https://old.example", TunnelActive: true, TunnelVerified: true, TunnelState: "connected"})

	svc := storedService(t, m, "g", "api")
	svc.PublicURL = ""
	svc.TunnelActive = false
	svc.TunnelVerified = false
	svc.TunnelState = "inactive"
	if err := m.persistTunnelState(svc); err != nil {
		t.Fatal(err)
	}
	got := storedService(t, m, "g", "api")
	if got.PublicURL != "" || got.TunnelActive || got.TunnelVerified {
		t.Fatalf("stale tunnel state kept: %+v", got)
	}
}

func TestUpdateServiceNoopDoesNotNotify(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()
	seedService(t, m, Service{Group: "g", Slug: "api", Type: TypeGo, Status: "running", Running: true, UpdatedAt: "2026-01-01T00:00:00Z"})

	svc := storedService(t, m, "g", "api")
	m.persistRunState(svc)
	if got := storedService(t, m, "g", "api"); got.UpdatedAt != "2026-01-01T00:00:00Z" {
		t.Fatalf("no-op write bumped updated_at to %s", got.UpdatedAt)
	}
}

// A crash-looping container reports a new last log line on every poll; the
// registry must not be rewritten (and the UI re-notified) each time.
func TestPersistCrashThrottlesChangingReason(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()
	recent := time.Now().UTC().Format(time.RFC3339)
	seedService(t, m, Service{Group: "g", Slug: "api", Type: TypeGo, Status: "failed", LastError: "panic: attempt 1", UpdatedAt: recent})
	seedService(t, m, Service{Group: "g", Slug: "old", Type: TypeGo, Status: "failed", LastError: "panic: attempt 1", UpdatedAt: time.Now().Add(-2 * crashRewriteInterval).UTC().Format(time.RFC3339)})
	seedService(t, m, Service{Group: "g", Slug: "new", Type: TypeGo, Status: "running", Running: true, UpdatedAt: recent})

	for _, slug := range []string{"api", "old", "new"} {
		m.persistCrashAsync(Service{Group: "g", Slug: slug, LastError: "panic: attempt 2"})
	}
	deadline := time.Now().Add(3 * time.Second)
	for storedService(t, m, "g", "new").Status != "failed" || storedService(t, m, "g", "old").LastError != "panic: attempt 2" {
		if time.Now().After(deadline) {
			t.Fatal("first crash and aged crash must be recorded")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := storedService(t, m, "g", "api"); got.LastError != "panic: attempt 1" || got.UpdatedAt != recent {
		t.Fatalf("recent crash rewritten: %+v", got)
	}
}
