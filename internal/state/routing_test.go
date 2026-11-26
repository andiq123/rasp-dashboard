package state

import "testing"

func TestParseServiceRouting(t *testing.T) {
	rules := "0:\tfrom all lookup local\n20000:\tfrom all to 198.41.192.0/24 ipproto tcp dport 7844 lookup main\n20100:\tfrom all uidrange 64000-64000 lookup main\n32765:\tnot from all fwmark 0xca6c lookup 51820\n"
	if got := parseServiceRouting(rules); !got.AppsDirect || !got.TunnelsDirect {
		t.Fatalf("got %+v", got)
	}
	if got := parseServiceRouting("32766:\tfrom all lookup main\n"); got.AppsDirect || got.TunnelsDirect {
		t.Fatalf("plain main rule must not count: %+v", got)
	}
}
