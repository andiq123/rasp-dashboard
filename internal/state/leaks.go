package state

import (
	"bufio"
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const leakCheckTTL = time.Minute

// LeakCheck verifies that Wi-Fi traffic can only leave through the tunnel:
// a forwarding kill switch, no IPv6 path, and DNS lookups routed via WireGuard.
type LeakCheck struct {
	Checked      bool     `json:"checked"`
	OK           bool     `json:"ok"`
	KillSwitch   bool     `json:"kill_switch"`
	IPv6Blocked  bool     `json:"ipv6_blocked"`
	DNSViaTunnel bool     `json:"dns_via_tunnel"`
	DNSServers   []string `json:"dns_servers,omitempty"`
	Problems     []string `json:"problems,omitempty"`
}

type leakCache struct {
	mu      sync.Mutex
	at      time.Time
	running bool
	result  LeakCheck
}

// readLeakCheck never blocks: a stale result refreshes in the background.
func (r *Reader) readLeakCheck(wg string) *LeakCheck {
	if wg == "" {
		wg = "mullvad-wg"
	}
	c := &r.leaks
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.running && time.Since(c.at) >= leakCheckTTL {
		c.running = true
		go func() {
			res := runLeakCheck(r.BaseDir, wg)
			c.mu.Lock()
			c.result, c.at, c.running = res, time.Now(), false
			c.mu.Unlock()
		}()
	}
	if !c.result.Checked {
		return nil
	}
	res := c.result
	return &res
}

func runLeakCheck(baseDir, wg string) LeakCheck {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	res := LeakCheck{Checked: true}

	if out, err := exec.CommandContext(ctx, "sudo", "-n", "iptables", "-S", "FORWARD").Output(); err == nil {
		res.KillSwitch = killSwitchActive(string(out), hotspotInterface, wg)
	}
	if !res.KillSwitch {
		res.Problems = append(res.Problems, "Wi‑Fi traffic is not limited to the tunnel")
	}

	fwd, _ := os.ReadFile("/proc/sys/net/ipv6/conf/all/forwarding")
	res.IPv6Blocked = strings.TrimSpace(string(fwd)) == "0"
	if !res.IPv6Blocked {
		res.Problems = append(res.Problems, "IPv6 forwarding is on")
	}

	conf, _ := os.ReadFile(filepath.Join(baseDir, "run", "dnsmasq-uap0.conf"))
	res.DNSServers = dnsServers(string(conf))
	res.DNSViaTunnel = len(res.DNSServers) > 0
	for _, server := range res.DNSServers {
		out, err := exec.CommandContext(ctx, "ip", "route", "get", server).Output()
		if err != nil || !routeUsesDevice(string(out), wg) {
			res.DNSViaTunnel = false
		}
	}
	if !res.DNSViaTunnel {
		res.Problems = append(res.Problems, "DNS lookups do not go through the tunnel")
	}
	res.OK = len(res.Problems) == 0
	return res
}

// killSwitchActive: forwarding drops by default and the hotspot may only
// forward into the tunnel (no rule lets it reach another interface).
func killSwitchActive(rules, hotspot, wg string) bool {
	policyDrop := false
	s := bufio.NewScanner(strings.NewReader(rules))
	for s.Scan() {
		f := strings.Fields(s.Text())
		if len(f) >= 3 && f[0] == "-P" && f[1] == "FORWARD" {
			policyDrop = f[2] == "DROP"
			continue
		}
		if len(f) < 2 || f[0] != "-A" || !strings.Contains(s.Text(), "-j ACCEPT") {
			continue
		}
		in, out := flagValue(f, "-i"), flagValue(f, "-o")
		if in == hotspot && out != wg {
			return false
		}
	}
	return policyDrop
}

func flagValue(fields []string, flag string) string {
	for i := 0; i+1 < len(fields); i++ {
		if fields[i] == flag {
			return fields[i+1]
		}
	}
	return ""
}

// dnsServers lists the upstream IPs dnsmasq forwards to (server=IP lines).
func dnsServers(conf string) []string {
	var out []string
	for _, line := range strings.Split(conf, "\n") {
		v, ok := strings.CutPrefix(strings.TrimSpace(line), "server=")
		if !ok {
			continue
		}
		v, _, _ = strings.Cut(v, "#")
		if ip := net.ParseIP(strings.TrimSpace(v)); ip != nil {
			out = append(out, ip.String())
		}
	}
	return out
}

func routeUsesDevice(route, dev string) bool {
	f := strings.Fields(route)
	return flagValue(f, "dev") == dev
}
