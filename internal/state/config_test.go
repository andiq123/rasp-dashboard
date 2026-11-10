package state

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveConfigRejectsMultilineValues(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(base, "config", "env")
	seed := "SSID=home\nPASSWORD=hunter22\nHOTSPOT_IP=192.168.100.1\nDHCP_START=192.168.100.10\nDHCP_END=192.168.100.50\nWG_IF=wg0\n"
	if err := os.WriteFile(path, []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}

	err := SaveConfig(base, Config{SSID: "evil\nWG_IF=$(reboot)", HotspotIP: "192.168.100.1"})
	if err == nil {
		t.Fatal("multi-line SSID must be rejected")
	}
	b, _ := os.ReadFile(path)
	if string(b) != seed {
		t.Fatalf("env file changed after rejected save:\n%s", b)
	}

	if err := SaveConfig(base, Config{SSID: "cafe", HotspotIP: "192.168.100.1", DHCPStart: "192.168.100.10", DHCPEnd: "192.168.100.50"}); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(path)
	got := string(b)
	if !strings.Contains(got, "SSID=cafe\n") || !strings.Contains(got, "PASSWORD=hunter22\n") || !strings.Contains(got, "WG_IF=wg0\n") {
		t.Fatalf("unexpected env after save:\n%s", got)
	}
}

func TestSaveConfigAppendsMissingKeys(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(base, "config", "env")
	if err := os.WriteFile(path, []byte("# hotspot\nSSID=home\nWG_IF=wg0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SaveConfig(base, Config{SSID: "cafe", Password: "hunter22", HotspotIP: "192.168.100.1"}); err != nil {
		t.Fatal(err)
	}
	got, err := LoadConfig(base)
	if err != nil {
		t.Fatal(err)
	}
	if got.SSID != "cafe" || got.Password != "hunter22" || got.HotspotIP != "192.168.100.1" || got.WGInterface != "wg0" {
		t.Fatalf("saved values lost: %+v", got)
	}
	b, _ := os.ReadFile(path)
	if strings.Contains(string(b), "DHCP_START=") || !strings.HasPrefix(string(b), "# hotspot\n") {
		t.Fatalf("empty keys must not be added and comments must stay:\n%s", b)
	}
	if err := SaveConfig(base, Config{SSID: "a\nb"}); !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("want ErrInvalidConfig, got %v", err)
	}
}
