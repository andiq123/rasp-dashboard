package state

import (
	"context"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ServiceRouting reports whether deployed apps and their public Cloudflare
// tunnels leave through Ethernet directly instead of the hotspot VPN.
type ServiceRouting struct {
	AppsDirect    bool `json:"apps_direct"`
	TunnelsDirect bool `json:"tunnels_direct"`
}

type routingCache struct {
	mu  sync.Mutex
	at  time.Time
	val ServiceRouting
}

const routingTTL = 30 * time.Second

func (r *Reader) readServiceRouting() ServiceRouting {
	c := &r.routing
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.at.IsZero() && time.Since(c.at) < routingTTL {
		return c.val
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ip", "-4", "rule", "show").Output()
	if err == nil {
		c.val = parseServiceRouting(string(out))
	}
	c.at = time.Now()
	return c.val
}

// parseServiceRouting looks for the policy rules that send app traffic (uid
// 64000) and Cloudflare tunnel traffic (port 7844) to the main table.
func parseServiceRouting(rules string) ServiceRouting {
	var s ServiceRouting
	for _, line := range strings.Split(rules, "\n") {
		if !strings.Contains(line, "lookup main") {
			continue
		}
		if strings.Contains(line, "uidrange 64000-64000") {
			s.AppsDirect = true
		}
		if strings.Contains(line, "dport 7844") {
			s.TunnelsDirect = true
		}
	}
	return s
}
