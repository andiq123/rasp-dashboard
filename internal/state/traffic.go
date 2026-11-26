package state

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Traffic is live throughput per hop of the hotspot path in bytes per second.
// "Down" is data travelling toward whoever asked for it (into the Pi, or to
// Wi-Fi devices); "Up" is requests and uploads travelling toward the internet.
type Traffic struct {
	UplinkBPS      float64 `json:"uplink_bps"`
	TunnelBPS      float64 `json:"tunnel_bps"`
	HotspotBPS     float64 `json:"hotspot_bps"`
	UplinkDownBPS  float64 `json:"uplink_down_bps"`
	UplinkUpBPS    float64 `json:"uplink_up_bps"`
	TunnelDownBPS  float64 `json:"tunnel_down_bps"`
	TunnelUpBPS    float64 `json:"tunnel_up_bps"`
	HotspotDownBPS float64 `json:"hotspot_down_bps"`
	HotspotUpBPS   float64 `json:"hotspot_up_bps"`
}

type ifaceCounters struct{ rx, tx uint64 }

type trafficCache struct {
	mu   sync.Mutex
	at   time.Time
	prev map[string]ifaceCounters
	last Traffic
}

func readCounter(iface, name string) (uint64, bool) {
	b, err := os.ReadFile(filepath.Join("/sys/class/net", iface, "statistics", name))
	if err != nil {
		return 0, false
	}
	n, err := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
	return n, err == nil
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
	cur := map[string]ifaceCounters{}
	for _, iface := range []string{wan, wg, hotspotInterface} {
		rx, ok1 := readCounter(iface, "rx_bytes")
		tx, ok2 := readCounter(iface, "tx_bytes")
		if ok1 && ok2 {
			cur[iface] = ifaceCounters{rx, tx}
		}
	}
	secs := now.Sub(c.at).Seconds()
	rate := func(iface string) (rx, tx float64) {
		n, ok := cur[iface]
		p, had := c.prev[iface]
		if !ok || !had || secs <= 0 || n.rx < p.rx || n.tx < p.tx {
			return 0, 0
		}
		return float64(n.rx-p.rx) / secs, float64(n.tx-p.tx) / secs
	}
	if c.prev != nil {
		upRx, upTx := rate(wan)
		tuRx, tuTx := rate(wg)
		hsRx, hsTx := rate(hotspotInterface)
		c.last = Traffic{
			UplinkBPS: upRx + upTx, TunnelBPS: tuRx + tuTx, HotspotBPS: hsRx + hsTx,
			// On the uplink and tunnel, received data is coming in; on the hotspot
			// the Pi transmits what devices download and receives their requests.
			UplinkDownBPS: upRx, UplinkUpBPS: upTx,
			TunnelDownBPS: tuRx, TunnelUpBPS: tuTx,
			HotspotDownBPS: hsTx, HotspotUpBPS: hsRx,
		}
	}
	c.prev, c.at = cur, now
	return c.last
}
