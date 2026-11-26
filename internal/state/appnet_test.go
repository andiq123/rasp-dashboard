package state

import "testing"

func TestParseSSKeepsOnlyInternetPeers(t *testing.T) {
	out := "0      0   127.0.0.1:5432   127.0.0.1:54778 users:((\"docker-proxy\",pid=1815,fd=3))\n" +
		"\t cubic bytes_sent:1691 bytes_acked:1691 bytes_received:3921\n" +
		"0      0   192.168.100.81:50000   140.82.112.3:443 users:((\"app\",pid=627423,fd=9))\n" +
		"\t cubic bytes_sent:1000 bytes_acked:1000 bytes_received:5000\n" +
		"0      0   192.168.100.81:50002   104.16.1.1:7844 users:((\"cloudflared\",pid=42,fd=7))\n" +
		"\t cubic bytes_sent:10 bytes_received:20\n"
	owners := parseSS(out)
	if len(owners) != 2 {
		t.Fatalf("owners = %+v", owners)
	}
	if owners[0].comm != "app" || owners[0].pid != 627423 || owners[0].in != 5000 || owners[0].out != 1000 {
		t.Fatalf("app owner = %+v", owners[0])
	}
	if kind, name := classifyOwner("cloudflared", 42, nil); kind != "links" || name != "cloudflared" {
		t.Fatalf("cloudflared = %s/%s", kind, name)
	}
}
