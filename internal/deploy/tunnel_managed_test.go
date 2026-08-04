package deploy

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testManagedTunnelToken(t *testing.T, tunnelID string) string {
	t.Helper()
	b, err := json.Marshal(map[string]string{"a": "account", "t": tunnelID, "s": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func TestNormalizeTunnelHostname(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  string
	}{
		{"app.example.com", "app.example.com"},
		{" HTTPS://App.Example.com/ ", "app.example.com"},
	} {
		got, err := normalizeTunnelHostname(tc.input)
		if err != nil || got != tc.want {
			t.Fatalf("normalizeTunnelHostname(%q) = %q, %v; want %q", tc.input, got, err, tc.want)
		}
	}

	for _, input := range []string{"localhost", "https://app.example.com/path", "app.example.com:443", "-bad.example"} {
		if _, err := normalizeTunnelHostname(input); err == nil {
			t.Fatalf("normalizeTunnelHostname(%q) should fail", input)
		}
	}
}

func TestStopTunnelPersistsClearedPublicState(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	original := Service{
		Group: "apps", Slug: "api", Type: TypeGo, Name: "API", Port: 5100,
		PublicURL: "https://api.example.com", PublicPath: "/health",
		TunnelActive: true, TunnelVerified: true, TunnelConfigured: true,
		TunnelMode: "managed", TunnelHostname: "api.example.com", StaticHost: "api.example.com",
		Deployments: []Deployment{{ID: "dpl_old", Status: "building"}},
	}
	if err := m.saveRegistry(registry{
		Groups: []Group{{Slug: "apps", Name: "Apps"}}, Services: []Service{original},
	}); err != nil {
		t.Fatal(err)
	}
	m.writeTunnelWanted("apps", "api", true)
	m.writeTunnelURL("apps", "api", original.PublicURL)

	returned, err := m.StopTunnel(context.Background(), "apps", "api")
	if err != nil {
		t.Fatal(err)
	}
	if returned.PublicURL != "" || returned.TunnelActive || returned.TunnelVerified {
		t.Fatalf("returned tunnel state was not cleared: %+v", returned)
	}
	reg, err := m.loadRegistry()
	if err != nil {
		t.Fatal(err)
	}
	saved, idx := findService(reg, "apps", "api")
	if idx < 0 {
		t.Fatal("saved service missing")
	}
	if saved.PublicURL != "" || saved.PublicPath != "" || saved.TunnelActive || saved.TunnelVerified {
		t.Fatalf("registry retained stale public state: %+v", saved)
	}
	if !saved.TunnelConfigured || saved.TunnelMode != "managed" || saved.TunnelHostname != "api.example.com" {
		t.Fatalf("reusable managed configuration was lost: %+v", saved)
	}
}

func TestManagedTunnelTokenIsOwnerOnly(t *testing.T) {
	m := &Manager{DeployDir: t.TempDir()}
	token := testManagedTunnelToken(t, "01ac4b15-bb9a-4649-bbae-fb9605930d23")
	if err := m.writeManagedTunnelToken("group", "app", token); err != nil {
		t.Fatal(err)
	}

	path := m.managedTunnelTokenPath("group", "app")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("token mode = %o; want 600", got)
	}
	if got := infoMode(t, filepath.Dir(path)); got != 0o700 {
		t.Fatalf("token directory mode = %o; want 700", got)
	}
	if !m.hasManagedTunnelToken("group", "app") {
		t.Fatal("saved token not detected")
	}
}

func TestManagedTunnelTokenRejectsInvalidAndDuplicateTunnel(t *testing.T) {
	m := &Manager{DeployDir: t.TempDir()}
	if err := m.writeManagedTunnelToken("group", "bad", "eyJ-not-a-cloudflare-token"); err == nil {
		t.Fatal("invalid token should be rejected")
	}
	token := testManagedTunnelToken(t, "715cac91-3dfa-4a9d-8fac-4d649ecee8f6")
	if err := m.writeManagedTunnelToken("apps", "one", token); err != nil {
		t.Fatal(err)
	}
	if err := m.writeManagedTunnelToken("apps", "two", token); err == nil {
		t.Fatal("duplicate tunnel assignment should be rejected")
	}
	if err := m.writeManagedTunnelToken("apps", "one", token); err != nil {
		t.Fatalf("rewriting the owning service should be allowed: %v", err)
	}
}

func TestTunnelConnectionStatusUsesCurrentLogSession(t *testing.T) {
	m := &Manager{DeployDir: t.TempDir()}
	id := "01ac4b15-bb9a-4649-bbae-fb9605930d23"
	if err := m.writeManagedTunnelToken("dashboard", "port-8484", testManagedTunnelToken(t, id)); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(m.tunnelDir("dashboard", "port-8484"), "cloudflared.log")
	log := "Registered tunnel connection connIndex=0\nStarting tunnel tunnelID=" + id + "\nRegistered tunnel connection connIndex=0\n"
	if err := os.WriteFile(logPath, []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	got := m.tunnelConnectionStatusForProcess("dashboard", "port-8484", true)
	if !got.Connected || got.State != "connected" || got.TunnelID != id {
		t.Fatalf("status = %+v", got)
	}
	log = "Starting tunnel tunnelID=715cac91-3dfa-4a9d-8fac-4d649ecee8f6\nRegistered tunnel connection connIndex=0\n"
	if err := os.WriteFile(logPath, []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	got = m.tunnelConnectionStatusForProcess("dashboard", "port-8484", true)
	if got.State != "misconfigured" || got.Connected {
		t.Fatalf("mismatched status = %+v", got)
	}

	m.writeTunnelURL("dashboard", "port-8484", "https://main.firewifi.online")
	log = "Starting tunnel tunnelID=" + id + "\nRegistered tunnel connection connIndex=0\n" +
		`Updated to new configuration config="{\"ingress\":[{\"hostname\":\"999scraper.firewifi.online\"}]}"` + "\n"
	if err := os.WriteFile(logPath, []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	got = m.tunnelConnectionStatusForProcess("dashboard", "port-8484", true)
	if got.State != "misconfigured" || got.Connected {
		t.Fatalf("wrong remote hostname status = %+v", got)
	}

	log = "Starting tunnel tunnelID=" + id + "\nRegistered tunnel connection connIndex=0\n" +
		"Failed to serve tunnel connection connIndex=0\n"
	if err := os.WriteFile(logPath, []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Minute)
	if err := os.Chtimes(logPath, old, old); err != nil {
		t.Fatal(err)
	}
	got = m.tunnelConnectionStatusForProcess("dashboard", "port-8484", true)
	if got.State != "disconnected" || got.Connected {
		t.Fatalf("disconnected status = %+v", got)
	}
}

func infoMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}
