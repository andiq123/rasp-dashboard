package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestApplyThrottleFlagsSeparatesCurrentFromHistorical(t *testing.T) {
	var historical ThermalMetrics
	applyThrottleFlags(&historical, 0xe0000)
	if historical.Throttled || !historical.ThrottledBefore || !historical.ThrottleKnown {
		t.Fatalf("historical flags parsed incorrectly: %+v", historical)
	}

	var current ThermalMetrics
	applyThrottleFlags(&current, 0x5)
	if !current.Throttled || current.ThrottledBefore {
		t.Fatalf("current flags parsed incorrectly: %+v", current)
	}
}

func TestReadWireGuardPeer(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	config := "[Interface]\nPrivateKey = redacted\n\n# Mullvad relay: ro-buh-wg-011\n[Peer]\nEndpoint = 37.120.246.130:51820\n"
	if err := os.WriteFile(filepath.Join(base, "config", "mullvad-wg.conf"), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	relay, endpoint := readWireGuardPeer(base)
	if relay != "ro-buh-wg-011" || endpoint != "37.120.246.130:51820" {
		t.Fatalf("relay=%q endpoint=%q", relay, endpoint)
	}
}

func TestHealthIssuesReportsStaleHandshake(t *testing.T) {
	age := int64(421)
	st := State{
		Mode:           ModeMullvad,
		HotspotRunning: true,
		VPNHealth: VPNHealth{
			InterfaceUp:         true,
			HandshakeAgeSeconds: &age,
		},
	}
	issues := healthIssues(st)
	if len(issues) != 1 || issues[0].Code != "vpn-handshake-stale" || issues[0].Action != "repair-vpn" {
		t.Fatalf("unexpected issues: %+v", issues)
	}
}

func TestLastIPv4(t *testing.T) {
	got := lastIPv4("Server: 192.168.100.1 Address: 192.168.100.1 Name: example Address: 45.83.223.193")
	if got != "45.83.223.193" {
		t.Fatalf("got %q", got)
	}
}
