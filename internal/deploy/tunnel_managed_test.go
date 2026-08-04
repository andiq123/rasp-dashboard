package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

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

func TestManagedTunnelTokenIsOwnerOnly(t *testing.T) {
	m := &Manager{DeployDir: t.TempDir()}
	token := "eyJ-test-token-that-is-long-enough-to-store-safely"
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

func infoMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}
