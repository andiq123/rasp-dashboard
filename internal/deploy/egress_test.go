package deploy

import (
	"strings"
	"testing"
)

func TestServicesBypassVPN(t *testing.T) {
	const healthy = `0:	from all lookup local
20000:	from all to 198.41.192.0/24 ipproto tcp dport 7844 lookup main
20100:	from all uidrange 64000-64000 lookup main
32764:	from all lookup main suppress_prefixlength 0
32765:	not from all fwmark 0xca6c lookup 51820
32766:	from all lookup main`
	if !servicesBypassVPN(healthy) {
		t.Fatal("rule before the VPN rule must count")
	}
	// What a VPN restart leaves behind when the rule was not re-added afterwards.
	const overtaken = `0:	from all lookup local
20098:	from all lookup main suppress_prefixlength 0
20099:	not from all fwmark 0xca6c lookup 51820
20100:	from all uidrange 64000-64000 lookup main
32766:	from all lookup main`
	if servicesBypassVPN(overtaken) {
		t.Fatal("a rule behind the VPN rule does nothing")
	}
	for name, rules := range map[string]string{
		"missing":    "0:	from all lookup local\n32765:	not from all fwmark 0xca6c lookup 51820",
		"other user": "20100:	from all uidrange 1000-1000 lookup main\n32765:	not from all fwmark 0xca6c lookup 51820",
	} {
		if servicesBypassVPN(rules) {
			t.Fatalf("%s: must not count", name)
		}
	}
}

func TestServiceEgressArgs(t *testing.T) {
	args := strings.Join(serviceEgressArgs(), " ")
	if !strings.Contains(args, "--user 64000:64000") {
		t.Fatalf("containers must run as the routed user: %s", args)
	}
	if !strings.Contains(args, "--dns 1.1.1.1") {
		t.Fatalf("containers must not inherit the VPN resolver: %s", args)
	}
}
