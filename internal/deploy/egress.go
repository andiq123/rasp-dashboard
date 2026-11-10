package deploy

import (
	"context"
	"runtime"
	"strconv"
	"strings"
)

// Service egress: apps reach the internet through the Pi's physical uplink, never
// through the hotspot VPN.
//
// Every app container runs as one dedicated unprivileged user, and a single policy
// routing rule sends that user's traffic to the main table. Nothing is configured per
// service, so any service deployed later is covered automatically.
//
// The rule itself belongs to the host (scripts/host/firewifi-cloudflare-routing): it
// has to be re-added each time the VPN comes up, because WireGuard puts its own rule
// in front of whatever is first at that moment. The dashboard only puts containers
// under the rule and says so when the rule is missing.
//
// Hotspot clients are not affected: their packets are forwarded, not sent by this
// user, so they keep following the VPN rules the hotspot scripts install.
const (
	// serviceUID owns every app process. It needs no account: the kernel routes by
	// number. Must match SERVICES_UID in the host routing script.
	serviceUID = 64000
)

// serviceResolvers replace the host's resolv.conf, which names the VPN's resolver
// while the VPN is up: unreachable for traffic that does not go through it.
var serviceResolvers = []string{"1.1.1.1", "8.8.8.8"}

// serviceEgressArgs are the docker run flags that put a container under the rule.
func serviceEgressArgs() []string {
	id := strconv.Itoa(serviceUID)
	args := []string{"--user", id + ":" + id}
	for _, resolver := range serviceResolvers {
		args = append(args, "--dns", resolver)
	}
	return args
}

// servicesBypassVPN reads `ip rule show` output: whether a rule sends the services
// user to the main table before any rule that could send it to the VPN's table.
func servicesBypassVPN(rules string) bool {
	id := strconv.Itoa(serviceUID)
	for _, line := range strings.Split(rules, "\n") {
		if strings.Contains(line, "uidrange "+id+"-"+id) && strings.Contains(line, "lookup main") {
			return true
		}
		// A catch-all into a numbered table (WireGuard's) comes first: too late.
		if strings.Contains(line, "fwmark") && !strings.Contains(line, "lookup main") {
			return false
		}
	}
	return false
}

// warnIfServicesUseVPN tells the deploy log when apps would leave through the VPN.
func (m *Manager) warnIfServicesUseVPN(ctx context.Context) {
	if runtime.GOOS != "linux" {
		return // development machine: no policy routing
	}
	rules, err := runCmd(ctx, "ip", "-4", "rule", "show")
	if err != nil || servicesBypassVPN(rules) {
		return
	}
	if !strings.Contains(rules, "fwmark") {
		return // no VPN rule at all: everything already uses the uplink
	}
	m.logf("warn", "Services are routed through the hotspot VPN — run: sudo firewifi-cloudflare-routing start (after the VPN is up)")
}
