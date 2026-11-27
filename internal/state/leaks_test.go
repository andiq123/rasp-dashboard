package state

import "testing"

func TestKillSwitchActive(t *testing.T) {
	ok := "-P FORWARD DROP\n-A FORWARD -j DOCKER-USER\n-A FORWARD -i uap0 -o mullvad-wg -j ACCEPT\n-A FORWARD -i mullvad-wg -o uap0 -m state --state RELATED,ESTABLISHED -j ACCEPT\n"
	if !killSwitchActive(ok, "uap0", "mullvad-wg") {
		t.Fatal("tunnel-only forwarding is a working kill switch")
	}
	if killSwitchActive(ok+"-A FORWARD -i uap0 -o eth0 -j ACCEPT\n", "uap0", "mullvad-wg") {
		t.Fatal("a hotspot → Ethernet accept is a leak")
	}
	if killSwitchActive("-P FORWARD ACCEPT\n", "uap0", "mullvad-wg") {
		t.Fatal("accept-all forwarding is a leak")
	}
}

func TestDNSServersAndRoute(t *testing.T) {
	got := dnsServers("interface=uap0\nserver=8.8.8.8\nserver=8.8.4.4 # google\nno-resolv\nserver=/lan/192.168.1.1\n")
	if len(got) != 2 || got[0] != "8.8.8.8" || got[1] != "8.8.4.4" {
		t.Fatalf("got %v", got)
	}
	if !routeUsesDevice("8.8.8.8 dev mullvad-wg table 51820 src 10.72.167.208 uid 1000", "mullvad-wg") {
		t.Fatal("route through the tunnel")
	}
	if routeUsesDevice("8.8.8.8 via 192.168.1.1 dev eth0 src 192.168.1.5", "mullvad-wg") {
		t.Fatal("route over Ethernet")
	}
}
