package deploy

import (
	"context"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Service egress: apps reach the internet through the Pi's physical uplink, never
// through the hotspot VPN.
//
// Every app container runs as one dedicated unprivileged user, and a single policy
// routing rule sends that user's traffic to the main table. Nothing is configured per
// service, so any service deployed later is covered automatically.
//
// Hotspot clients are not affected: their packets are forwarded, not sent by this
// user, so they keep following the VPN rules the hotspot scripts install.
const (
	// serviceUID owns every app process. It needs no account: the kernel routes by number.
	serviceUID = 64000
	// egressRulePref sits before WireGuard's catch-all rule (32765) and after the
	// Cloudflare tunnel rules (20000–20003).
	egressRulePref = 20100
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

// egressRule is the rule's selector and action, as `ip rule` takes it.
func egressRule() []string {
	id := strconv.Itoa(serviceUID)
	return []string{"pref", strconv.Itoa(egressRulePref), "uidrange", id + "-" + id, "lookup", "main"}
}

// egressRulePresent reads `ip rule show` output for our rule.
func egressRulePresent(rules string) bool {
	id := strconv.Itoa(serviceUID)
	prefix := strconv.Itoa(egressRulePref) + ":"
	for _, line := range strings.Split(rules, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, prefix) && strings.Contains(line, "uidrange "+id+"-"+id) && strings.Contains(line, "lookup main") {
			return true
		}
	}
	return false
}

// EnsureServiceEgress installs the routing rule for IPv4 and IPv6 when it is missing.
// IPv6 matters too: the uplink has none, so apps fall back to IPv4 at once instead
// of leaving through the VPN's IPv6 route. Safe to call repeatedly.
func (m *Manager) EnsureServiceEgress(ctx context.Context) error {
	if runtime.GOOS != "linux" {
		return nil // development machine: no policy routing to manage
	}
	for _, family := range []string{"-4", "-6"} {
		rules, err := runCmd(ctx, "ip", family, "rule", "show")
		if err != nil {
			return fmt.Errorf("read routing rules: %s", strings.TrimSpace(rules))
		}
		if egressRulePresent(rules) {
			continue
		}
		args := append([]string{"-n", "ip", family, "rule", "add"}, egressRule()...)
		if out, err := runCmd(ctx, "sudo", args...); err != nil {
			return fmt.Errorf("add routing rule (%s): %s", family, strings.TrimSpace(out))
		}
		m.logf("ok", "Service egress rule installed (%s) — apps bypass the hotspot VPN", family)
	}
	return nil
}

// BootstrapServiceEgress installs the rule at startup and puts it back if anything
// removes it, so apps never drift onto the VPN unnoticed.
func (m *Manager) BootstrapServiceEgress() {
	if m == nil {
		return
	}
	check := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := m.EnsureServiceEgress(ctx); err != nil {
			m.logf("warn", "Service egress: %v", err)
		}
	}
	check()
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-m.bgDone():
			return
		case <-t.C:
			check()
		}
	}
}
