package state

import (
	"bufio"
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	uplinkProbeTTL        = 30 * time.Second
	uplinkProbeFailureTTL = 10 * time.Second
	clientsTTL            = 5 * time.Second
	defaultWANInterface   = "eth0"
	hotspotInterface      = "uap0"
)

// Uplink is the Pi's own internet connection: the input that the hotspot
// (the output) is routed through, via the tunnel or the proxy.
type Uplink struct {
	Interface string `json:"interface"`
	LinkUp    bool   `json:"link_up"`
	Internet  bool   `json:"internet"`
	Checked   bool   `json:"checked"`
}

type linkCache struct {
	mu         sync.Mutex
	probeAt    time.Time
	probing    bool
	internet   bool
	checked    bool
	probeIface string
	clientsAt  time.Time
	clients    int
}

// readUplink never blocks on the network: a stale probe refreshes in the background
// and the last known result is returned meanwhile.
func (r *Reader) readUplink(iface string) Uplink {
	if iface == "" {
		iface = defaultWANInterface
	}
	u := Uplink{Interface: iface, LinkUp: interfaceUp(iface)}
	c := &r.links
	c.mu.Lock()
	defer c.mu.Unlock()
	ttl := uplinkProbeTTL
	if !c.internet {
		ttl = uplinkProbeFailureTTL
	}
	if !c.probing && (c.probeIface != iface || time.Since(c.probeAt) >= ttl) {
		c.probing = true
		go func() {
			ok := u.LinkUp && probeInternet(iface)
			c.mu.Lock()
			c.internet, c.checked, c.probeIface, c.probeAt, c.probing = ok, true, iface, time.Now(), false
			c.mu.Unlock()
		}()
	}
	if c.probeIface == iface {
		u.Internet, u.Checked = c.internet && u.LinkUp, c.checked
	}
	return u
}

// readClients counts Wi-Fi stations associated with the hotspot.
func (r *Reader) readClients() *int {
	c := &r.links
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.clientsAt) >= clientsTTL {
		n, err := stationCount(hotspotInterface)
		if err != nil {
			return nil
		}
		c.clients, c.clientsAt = n, time.Now()
	}
	n := c.clients
	return &n
}

func interfaceUp(iface string) bool {
	b, err := os.ReadFile(filepath.Join("/sys/class/net", iface, "operstate"))
	return err == nil && strings.TrimSpace(string(b)) == "up"
}

func stationCount(iface string) (int, error) {
	bin := "/usr/sbin/iw"
	if _, err := os.Stat(bin); err != nil {
		bin = "iw"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, "dev", iface, "station", "dump").Output()
	if err != nil {
		return 0, err
	}
	return countStations(out), nil
}

func countStations(out []byte) int {
	n := 0
	s := bufio.NewScanner(bytes.NewReader(out))
	for s.Scan() {
		if strings.HasPrefix(s.Text(), "Station ") {
			n++
		}
	}
	return n
}
