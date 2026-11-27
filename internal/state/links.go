package state

import (
	"bufio"
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
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
	devicesAt  time.Time
	devices    []Device
	// Previous byte counters per MAC, to turn totals into live rates.
	deviceSeen map[string]deviceSample
}

type deviceSample struct {
	rx, tx uint64
	at     time.Time
}

// Device is one Wi-Fi station on the hotspot, joined with its DHCP lease.
type Device struct {
	MAC              string `json:"mac"`
	IP               string `json:"ip,omitempty"`
	Name             string `json:"name,omitempty"`
	SignalDBM        int    `json:"signal_dbm,omitempty"`
	ConnectedSeconds int64  `json:"connected_seconds"`
	RxBytes          uint64 `json:"rx_bytes"`
	TxBytes          uint64 `json:"tx_bytes"`
	// Live rates in bytes/s from the device's point of view: down is what the
	// hotspot sends it (station tx), up is what it sends (station rx).
	DownBPS float64 `json:"down_bps"`
	UpBPS   float64 `json:"up_bps"`
}

const dnsmasqLeases = "/var/lib/misc/dnsmasq.leases"

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

// readDevices lists Wi-Fi stations on the hotspot (cached briefly; iw is fast).
func (r *Reader) readDevices() []Device {
	c := &r.links
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.devicesAt) >= clientsTTL {
		out, err := stationDump(hotspotInterface)
		if err != nil {
			return nil
		}
		devices := parseStations(out)
		leases := readLeases(dnsmasqLeases)
		for i := range devices {
			if l, ok := leases[devices[i].MAC]; ok {
				devices[i].IP, devices[i].Name = l.ip, l.name
			}
		}
		now := time.Now()
		c.deviceSeen = applyDeviceRates(devices, c.deviceSeen, now)
		c.devices, c.devicesAt = devices, now
	}
	return append([]Device(nil), c.devices...)
}

// applyDeviceRates fills live rates from the previous sample and returns the
// new samples. Counter resets (reconnects) and first sightings read as zero.
func applyDeviceRates(devices []Device, prev map[string]deviceSample, now time.Time) map[string]deviceSample {
	next := make(map[string]deviceSample, len(devices))
	for i := range devices {
		d := &devices[i]
		if p, ok := prev[d.MAC]; ok {
			if dt := now.Sub(p.at).Seconds(); dt > 0.5 && d.RxBytes >= p.rx && d.TxBytes >= p.tx {
				d.DownBPS = float64(d.TxBytes-p.tx) / dt
				d.UpBPS = float64(d.RxBytes-p.rx) / dt
			}
		}
		next[d.MAC] = deviceSample{rx: d.RxBytes, tx: d.TxBytes, at: now}
	}
	return next
}

func interfaceUp(iface string) bool {
	b, err := os.ReadFile(filepath.Join("/sys/class/net", iface, "operstate"))
	return err == nil && strings.TrimSpace(string(b)) == "up"
}

func stationDump(iface string) ([]byte, error) {
	bin := "/usr/sbin/iw"
	if _, err := os.Stat(bin); err != nil {
		bin = "iw"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, bin, "dev", iface, "station", "dump").Output()
}

// parseStations reads `iw dev <if> station dump` output.
func parseStations(out []byte) []Device {
	var devices []Device
	s := bufio.NewScanner(bytes.NewReader(out))
	for s.Scan() {
		line := s.Text()
		if strings.HasPrefix(line, "Station ") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				devices = append(devices, Device{MAC: strings.ToLower(fields[1])})
			}
			continue
		}
		if len(devices) == 0 {
			continue
		}
		d := &devices[len(devices)-1]
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		first := ""
		if f := strings.Fields(value); len(f) > 0 {
			first = f[0]
		}
		switch key {
		case "rx bytes":
			d.RxBytes, _ = strconv.ParseUint(first, 10, 64)
		case "tx bytes":
			d.TxBytes, _ = strconv.ParseUint(first, 10, 64)
		case "signal":
			d.SignalDBM, _ = strconv.Atoi(first)
		case "connected time":
			d.ConnectedSeconds, _ = strconv.ParseInt(first, 10, 64)
		}
	}
	return devices
}

type lease struct{ ip, name string }

// readLeases maps MAC → lease from a dnsmasq lease file ("expiry mac ip name id").
func readLeases(path string) map[string]lease {
	leases := map[string]lease{}
	b, err := os.ReadFile(path)
	if err != nil {
		return leases
	}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		name := f[3]
		if name == "*" {
			name = ""
		}
		leases[strings.ToLower(f[1])] = lease{ip: f[2], name: name}
	}
	return leases
}

func countStations(out []byte) int { return len(parseStations(out)) }
