package deploy

import (
	"strings"
	"testing"
)

func TestEgressRulePresent(t *testing.T) {
	const withRule = `0:	from all lookup local
20000:	from all to 198.41.192.0/24 ipproto tcp dport 7844 lookup main
20100:	from all uidrange 64000-64000 lookup main
32765:	not from all fwmark 0xca6c lookup 51820
32766:	from all lookup main`
	if !egressRulePresent(withRule) {
		t.Fatal("rule must be recognised in ip rule output")
	}
	for name, rules := range map[string]string{
		"missing":        "0:	from all lookup local\n32766:	from all lookup main",
		"other user":     "20100:	from all uidrange 1000-1000 lookup main",
		"other table":    "20100:	from all uidrange 64000-64000 lookup 51820",
		"other priority": "30000:	from all uidrange 64000-64000 lookup main",
	} {
		if egressRulePresent(rules) {
			t.Fatalf("%s: must not count as our rule", name)
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
	if rule := strings.Join(egressRule(), " "); rule != "pref 20100 uidrange 64000-64000 lookup main" {
		t.Fatalf("unexpected rule: %s", rule)
	}
}
