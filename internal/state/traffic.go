package state

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Traffic is live throughput per hop of the hotspot path, in bytes per second
// (received + sent). It drives how fast the flow diagram animates.
type Traffic struct {
	UplinkBPS  float64 `json:"uplink_bps"`
	TunnelBPS  float64 `json:"tunnel_bps"`
	HotspotBPS float64 `json:"hotspot_bps"`
}

type trafficCache struct {
	mu   sync.Mutex
	at   time.Time
	prev map[string]uint64
	last Traffic
}

// ifaceBytes returns rx+tx bytes for an interface, or false when it is absent.
func ifaceBytes(iface string) (uint64, bool) {
	var total uint64
	for _, name := range []string{"rx_bytes", "tx_bytes"} {
		b, err := os.ReadFile(filepath.Join("/sys/class/net", iface, "statistics", name))
		if err != nil {
			return 0, false
		}
		n, err := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
		if err != nil {
			return 0, false
		}
		total += n
	}
	return total, true
}

// readTraffic turns interface counters into rates between successive reads.
// Reads closer than a second apart reuse the last result.
func (r *Reader) readTraffic(wan, wg string) Traffic {
	if wan == "" {
		wan = defaultWANInterface
	}
	if wg == "" {
		wg = "mullvad-wg"
	}
	c := &r.traffic
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if !c.at.IsZero() && now.Sub(c.at) < time.Second {
		return c.last
	}
	cur := map[string]uint64{}
	for _, iface := range []string{wan, wg, hotspotInterface} {
		if n, ok := ifaceBytes(iface); ok {
			cur[iface] = n
		}
	}
	rate := func(iface string) float64 {
		n, ok := cur[iface]
		p, had := c.prev[iface]
		secs := now.Sub(c.at).Seconds()
		if !ok || !had || n < p || secs <= 0 {
			return 0
		}
		return float64(n-p) / secs
	}
	if c.prev != nil {
		c.last = Traffic{UplinkBPS: rate(wan), TunnelBPS: rate(wg), HotspotBPS: rate(hotspotInterface)}
	}
	c.prev, c.at = cur, now
	return c.last
}
