package state

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	ModeMullvad     = "mullvad"
	ModeResidential = "residential"
	defaultMode     = ModeMullvad

	portCheckTimeout = 2 * time.Second
	vpnStatusTTL     = 2 * time.Second
	// Egress changes slowly; probing gently keeps the geo services within their
	// free limits. Handshake and interface are still checked every read.
	vpnEgressTTL        = 2 * time.Minute
	vpnEgressFailureTTL = 15 * time.Second
	// A verified exit is only marked failed after this many consecutive
	// unverifiable probes, so one slow reply never triggers a tunnel repair.
	egressFailuresToFlip = 3
	// WireGuard can legitimately keep using a session for roughly two minutes;
	// real egress catches outages sooner, so this threshold avoids false alarms.
	maxHandshakeAge = 3 * time.Minute
)

func ValidMode(m string) bool {
	return m == ModeMullvad || m == ModeResidential
}

// State is the full runtime snapshot of the system.
type State struct {
	Mode           string          `json:"mode"`
	HotspotRunning bool            `json:"hotspot_running"`
	SSID           string          `json:"ssid"`
	HotspotIP      string          `json:"hotspot_ip"`
	DHCPStart      string          `json:"dhcp_start"`
	DHCPEnd        string          `json:"dhcp_end"`
	WGUp           bool            `json:"wg_up"`
	VPNHealth      VPNHealth       `json:"vpn_health"`
	VPNRepair      *VPNRepair      `json:"vpn_repair,omitempty"`
	Issues         []HealthIssue   `json:"issues"`
	ProxyRunning   bool            `json:"proxy_running"`
	Uplink         Uplink          `json:"uplink"`
	Traffic        Traffic         `json:"traffic"`
	Routing        ServiceRouting  `json:"routing"`
	NetUsers       []NetUser       `json:"net_users,omitempty"`
	Clients        *int            `json:"clients,omitempty"`
	Devices        []Device        `json:"devices,omitempty"`
	MullvadAccount *MullvadAccount `json:"mullvad_account,omitempty"`
	DeviceMetrics  DeviceMetrics   `json:"device_metrics"`
	FilesRoot      string          `json:"files_root,omitempty"`
	GeneratedAt    string          `json:"generated_at"`
}

type VPNRepair struct {
	Active      bool   `json:"active"`
	Automatic   bool   `json:"automatic"`
	Phase       string `json:"phase"`
	FailedPhase string `json:"failed_phase,omitempty"`
	Message     string `json:"message"`
	Attempt     int    `json:"attempt"`
	StartedAt   string `json:"started_at,omitempty"`
	UpdatedAt   string `json:"updated_at,omitempty"`
	FinishedAt  string `json:"finished_at,omitempty"`
	NextRetryAt string `json:"next_retry_at,omitempty"`
	Error       string `json:"error,omitempty"`
}

type DeviceMetrics struct {
	CPU     CPUMetrics     `json:"cpu"`
	Memory  MemoryMetrics  `json:"memory"`
	Thermal ThermalMetrics `json:"thermal"`
	Storage StorageMetrics `json:"storage"`
	Network NetworkMetrics `json:"network"`
}

type CPUMetrics struct {
	BusyPercent float64 `json:"busy_percent"`
	IdlePercent float64 `json:"idle_percent"`
	Count       int     `json:"count"`
}

type MemoryMetrics struct {
	UsedBytes   uint64  `json:"used_bytes"`
	TotalBytes  uint64  `json:"total_bytes"`
	UsedPercent float64 `json:"used_percent"`
}

type ThermalMetrics struct {
	TemperatureCelsius float64 `json:"temperature_celsius"`
	Available          bool    `json:"available"`
	Throttled          bool    `json:"throttled"`
	ThrottledBefore    bool    `json:"throttled_before"`
	ThrottleKnown      bool    `json:"throttle_known"`
}

type VPNHealth struct {
	InterfaceUp         bool   `json:"interface_up"`
	HandshakeHealthy    bool   `json:"handshake_healthy"`
	HandshakeAgeSeconds *int64 `json:"handshake_age_seconds,omitempty"`
	EgressOK            bool   `json:"egress_ok"`
	CountryPolicy       string `json:"country_policy"`
	CountryAllowed      bool   `json:"country_allowed"`
	Relay               string `json:"relay,omitempty"`
	EgressServer        string `json:"egress_server,omitempty"`
	EgressCheckedAt     string `json:"egress_checked_at,omitempty"`
	Endpoint            string `json:"endpoint,omitempty"`
	LastRepairError     string `json:"last_repair_error,omitempty"`
	CheckedAt           string `json:"checked_at"`
	Error               string `json:"error,omitempty"`
}

type HealthIssue struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Action   string `json:"action,omitempty"`
}

type StorageMetrics struct {
	UsedBytes   uint64  `json:"used_bytes"`
	TotalBytes  uint64  `json:"total_bytes"`
	UsedPercent float64 `json:"used_percent"`
}

type NetworkMetrics struct {
	DownBytesPerSec float64 `json:"down_bytes_per_sec"`
	UpBytesPerSec   float64 `json:"up_bytes_per_sec"`
}

// Config holds editable hotspot settings persisted in config/env.
type Config struct {
	SSID         string `json:"ssid"`
	Password     string `json:"password,omitempty"`
	PasswordSet  bool   `json:"password_set,omitempty"`
	HotspotIP    string `json:"hotspot_ip"`
	DHCPStart    string `json:"dhcp_start"`
	DHCPEnd      string `json:"dhcp_end"`
	WGInterface  string `json:"-"`
	WANInterface string `json:"-"`
}

const shellStateCacheTTL = time.Second

type shellCache struct {
	at    time.Time
	state State
	err   error
}

// Reader reads system state from disk and running processes.
type Reader struct {
	BaseDir           string
	mu                sync.Mutex
	prev              metricsSample
	cacheMu           sync.Mutex
	shell             shellCache
	shellCh           chan struct{} // closed when in-flight ReadShellCached finishes
	vpnMu             sync.Mutex
	vpnAt             time.Time
	vpn               VPNHealth
	vpnEgressAt       time.Time
	vpnEgressRelay    string
	vpnEgressEndpoint string
	vpnEgressOK       bool
	vpnEgressServer   string
	vpnEgressError    string
	vpnEgressFails    int
	egress            egressProber
	links             linkCache
	account           accountCache
	traffic           trafficCache
	routing           routingCache
	netUsers          netUsersCache
}

type metricsSample struct {
	at       time.Time
	cpu      cpuSample
	netRx    uint64
	netTx    uint64
	hasValue bool
}

type cpuSample struct {
	total uint64
	idle  uint64
}

func NewReader(baseDir string) *Reader {
	return &Reader{BaseDir: baseDir}
}

func (r *Reader) Read() (State, error) {
	mode := r.readMode()
	cfg, _ := LoadConfig(r.BaseDir)
	hostapdRunning := processRunning("hostapd.*hostapd-uap0")
	dnsmasqRunning := processRunning("dnsmasq.*dnsmasq-uap0")
	vpn := r.readVPNHealth(cfg.WGInterface)
	metrics := r.readDeviceMetrics()
	st := State{
		Mode:           mode,
		HotspotRunning: hostapdRunning && dnsmasqRunning,
		SSID:           cfg.SSID,
		HotspotIP:      cfg.HotspotIP,
		DHCPStart:      cfg.DHCPStart,
		DHCPEnd:        cfg.DHCPEnd,
		WGUp:           vpn.InterfaceUp,
		VPNHealth:      vpn,
		ProxyRunning:   processRunning("redsocks.*redsocks-hotspot"),
		Uplink:         r.readUplink(cfg.WANInterface),
		Traffic:        r.readTraffic(cfg.WANInterface, cfg.WGInterface),
		Routing:        r.readServiceRouting(),
		NetUsers:       r.readNetUsers(),
		DeviceMetrics:  metrics,
		GeneratedAt:    time.Now().Format(time.RFC3339),
	}
	if st.HotspotRunning {
		if devices := r.readDevices(); devices != nil {
			n := len(devices)
			st.Devices, st.Clients = devices, &n
		} else {
			zero := 0
			st.Clients = &zero
		}
	}
	if acct := r.ReadMullvadAccount(); acct.Configured {
		st.MullvadAccount = &acct
	}
	st.Issues = healthIssues(st)
	return st, nil
}

func (r *Reader) readDeviceMetrics() DeviceMetrics {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	cpu := readCPUSample()
	rx, tx := readNetworkTotals()
	metrics := DeviceMetrics{
		CPU:     CPUMetrics{Count: readCPUCount()},
		Memory:  readMemoryMetrics(),
		Thermal: readThermalMetrics(),
		Storage: readStorageMetrics("/"),
	}

	if r.prev.hasValue {
		totalDelta := cpu.total - r.prev.cpu.total
		idleDelta := cpu.idle - r.prev.cpu.idle
		if totalDelta > 0 && idleDelta <= totalDelta {
			idle := float64(idleDelta) * 100 / float64(totalDelta)
			metrics.CPU.IdlePercent = idle
			metrics.CPU.BusyPercent = 100 - idle
		}

		seconds := now.Sub(r.prev.at).Seconds()
		if seconds > 0 {
			if rx >= r.prev.netRx {
				metrics.Network.DownBytesPerSec = float64(rx-r.prev.netRx) / seconds
			}
			if tx >= r.prev.netTx {
				metrics.Network.UpBytesPerSec = float64(tx-r.prev.netTx) / seconds
			}
		}
	}

	r.prev = metricsSample{at: now, cpu: cpu, netRx: rx, netTx: tx, hasValue: true}
	return metrics
}

func readCPUCount() int {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return 1
	}
	defer f.Close()
	n := 0
	s := bufio.NewScanner(f)
	for s.Scan() {
		if strings.HasPrefix(s.Text(), "processor") {
			n++
		}
	}
	if n < 1 {
		return 1
	}
	return n
}

func readCPUSample() cpuSample {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuSample{}
	}
	defer f.Close()

	var label string
	var user, nice, system, idle, iowait, irq, softirq, steal, guest, guestNice uint64
	if _, err := fmt.Fscan(f, &label, &user, &nice, &system, &idle, &iowait, &irq, &softirq, &steal, &guest, &guestNice); err != nil {
		return cpuSample{}
	}
	total := user + nice + system + idle + iowait + irq + softirq + steal + guest + guestNice
	return cpuSample{total: total, idle: idle + iowait}
}

func readMemoryMetrics() MemoryMetrics {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return MemoryMetrics{}
	}
	defer f.Close()

	values := map[string]uint64{}
	s := bufio.NewScanner(f)
	for s.Scan() {
		fields := strings.Fields(s.Text())
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			values[key] = value * 1024
		}
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	if total == 0 {
		return MemoryMetrics{}
	}
	used := total - available
	return MemoryMetrics{
		UsedBytes:   used,
		TotalBytes:  total,
		UsedPercent: float64(used) * 100 / float64(total),
	}
}

func readThermalMetrics() ThermalMetrics {
	metrics := ThermalMetrics{}
	if b, err := os.ReadFile("/sys/class/thermal/thermal_zone0/temp"); err == nil {
		raw := strings.TrimSpace(string(b))
		if milliC, err := strconv.ParseFloat(raw, 64); err == nil {
			metrics.TemperatureCelsius = milliC / 1000
			metrics.Available = true
		}
	}
	if !metrics.Available {
		if out, err := exec.Command("vcgencmd", "measure_temp").Output(); err == nil {
			text := strings.TrimSpace(string(out))
			text = strings.TrimPrefix(text, "temp=")
			text = strings.TrimSuffix(text, "'C")
			if c, err := strconv.ParseFloat(text, 64); err == nil {
				metrics.TemperatureCelsius = c
				metrics.Available = true
			}
		}
	}
	if out, err := exec.Command("vcgencmd", "get_throttled").Output(); err == nil {
		text := strings.TrimSpace(string(out))
		text = strings.TrimPrefix(text, "throttled=")
		value, err := strconv.ParseUint(text, 0, 64)
		if err == nil {
			applyThrottleFlags(&metrics, value)
		}
	}
	return metrics
}

func applyThrottleFlags(metrics *ThermalMetrics, value uint64) {
	metrics.ThrottleKnown = true
	// Bits 0-3 are current conditions; bits 16-19 only record past events.
	metrics.Throttled = value&0xF != 0
	metrics.ThrottledBefore = value&0xF0000 != 0
}

func readStorageMetrics(path string) StorageMetrics {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return StorageMetrics{}
	}
	total := st.Blocks * uint64(st.Bsize)
	free := st.Bavail * uint64(st.Bsize)
	if total == 0 {
		return StorageMetrics{}
	}
	used := total - free
	return StorageMetrics{
		UsedBytes:   used,
		TotalBytes:  total,
		UsedPercent: float64(used) * 100 / float64(total),
	}
}

func readNetworkTotals() (uint64, uint64) {
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0
	}
	defer f.Close()

	var rxTotal, txTotal uint64
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		iface := strings.TrimSpace(parts[0])
		if iface == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}
		rx, rxErr := strconv.ParseUint(fields[0], 10, 64)
		tx, txErr := strconv.ParseUint(fields[8], 10, 64)
		if rxErr == nil {
			rxTotal += rx
		}
		if txErr == nil {
			txTotal += tx
		}
	}
	return rxTotal, txTotal
}

func (r *Reader) readMode() string {
	b, err := os.ReadFile(filepath.Join(r.BaseDir, "run", ".mode"))
	if err != nil {
		return defaultMode
	}
	m := strings.TrimSpace(string(b))
	if ValidMode(m) {
		return m
	}
	return defaultMode
}

func processRunning(pattern string) bool {
	return exec.Command("pgrep", "-f", pattern).Run() == nil
}

func wgUp(iface string) bool {
	if iface == "" {
		return false
	}
	return exec.Command("ip", "link", "show", iface).Run() == nil
}

func (r *Reader) readVPNHealth(iface string) VPNHealth {
	r.vpnMu.Lock()
	defer r.vpnMu.Unlock()
	if !r.vpnAt.IsZero() && time.Since(r.vpnAt) < vpnStatusTTL {
		return r.vpn
	}

	now := time.Now()
	h := VPNHealth{InterfaceUp: wgUp(iface), CountryPolicy: "ro", CheckedAt: now.Format(time.RFC3339)}
	h.Relay, h.Endpoint = readWireGuardPeer(r.BaseDir)
	h.LastRepairError = readLastRepairError(r.BaseDir)
	h.CountryAllowed = strings.HasPrefix(h.Relay, "ro-")
	if !h.InterfaceUp {
		h.Error = "WireGuard interface is down"
		r.vpnEgressAt = time.Time{}
		r.vpn, r.vpnAt = h, now
		return h
	}

	out, err := exec.Command("sudo", "-n", "wg", "show", iface, "latest-handshakes").Output()
	if err != nil {
		h.Error = "Could not read WireGuard handshake"
	} else if fields := strings.Fields(string(out)); len(fields) >= 2 {
		if ts, parseErr := strconv.ParseInt(fields[1], 10, 64); parseErr == nil && ts > 0 {
			age := now.Unix() - ts
			if age < 0 {
				age = 0
			}
			h.HandshakeAgeSeconds = &age
			h.HandshakeHealthy = time.Duration(age)*time.Second <= maxHandshakeAge
		}
	}

	if h.HandshakeHealthy {
		egressTTL := vpnEgressTTL
		if !r.vpnEgressOK {
			egressTTL = vpnEgressFailureTTL
		}
		relayChanged := r.vpnEgressRelay != h.Relay || r.vpnEgressEndpoint != h.Endpoint
		if relayChanged {
			// A new relay must prove itself; nothing carries over from the old one.
			r.vpnEgressOK, r.vpnEgressFails = false, 0
		}
		if relayChanged || r.vpnEgressAt.IsZero() || time.Since(r.vpnEgressAt) >= egressTTL {
			r.applyEgress(r.egress.probe(iface))
			r.vpnEgressAt = now
			r.vpnEgressRelay = h.Relay
			r.vpnEgressEndpoint = h.Endpoint
		}
		h.EgressOK = r.vpnEgressOK
		h.EgressServer = r.vpnEgressServer
		h.EgressCheckedAt = r.vpnEgressAt.Format(time.RFC3339)
		if h.EgressServer != "" {
			h.CountryAllowed = h.CountryAllowed && strings.HasPrefix(h.EgressServer, "ro-")
		}
		if r.vpnEgressError != "" {
			h.Error = r.vpnEgressError
		}
	} else if h.Error == "" {
		h.Error = "WireGuard handshake is stale or missing"
		r.vpnEgressAt = time.Time{}
	}
	r.vpn, r.vpnAt = h, now
	return h
}

func readLastRepairError(baseDir string) string {
	b, err := os.ReadFile(filepath.Join(baseDir, "run", "vpn-repair-error"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func readWireGuardPeer(baseDir string) (string, string) {
	b, err := os.ReadFile(filepath.Join(baseDir, "config", "mullvad-wg.conf"))
	if err != nil {
		return "", ""
	}
	var relay, endpoint string
	for _, line := range strings.Split(string(b), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "# Mullvad relay:") {
			relay = strings.TrimSpace(strings.TrimPrefix(trimmed, "# Mullvad relay:"))
		}
		if strings.HasPrefix(trimmed, "Endpoint") {
			if parts := strings.SplitN(trimmed, "=", 2); len(parts) == 2 {
				endpoint = strings.TrimSpace(parts[1])
			}
		}
	}
	return relay, endpoint
}

// applyEgress folds one probe into the egress verdict: success and policy
// violations apply at once; unverifiable probes only flip a verified exit to
// failed after egressFailuresToFlip in a row.
func (r *Reader) applyEgress(res egressResult) {
	switch {
	case res.ok:
		r.vpnEgressOK, r.vpnEgressServer, r.vpnEgressFails, r.vpnEgressError = true, res.server, 0, ""
	case res.violation:
		r.vpnEgressOK, r.vpnEgressServer, r.vpnEgressFails = false, res.server, egressFailuresToFlip
		r.vpnEgressError = res.err.Error()
	default:
		r.vpnEgressFails++
		if !r.vpnEgressOK || r.vpnEgressFails >= egressFailuresToFlip {
			r.vpnEgressOK = false
			if res.err != nil {
				r.vpnEgressError = res.err.Error()
			}
		}
	}
}

// egressResult is one probe of the tunnel's exit country.
type egressResult struct {
	ok        bool   // verified Romanian exit
	violation bool   // verified exit outside Romania or outside Mullvad
	server    string // Mullvad server name when known
	err       error
}

// egressProber verifies Romanian egress through the tunnel. am.i.mullvad.net is
// authoritative when it answers; when it is unreachable from inside the tunnel
// it is skipped for a while, and one geo service answering RO verifies the exit
// (services alternate, the other is the fallback). Any non-RO answer is a
// violation. Mirrors verify_ro_egress in vpn-hotspot/bin/lib.sh.
type egressProber struct {
	skipMullvadUntil time.Time
	turn             int
}

const mullvadCheckSkip = 30 * time.Minute

func (p *egressProber) probe(iface string) egressResult {
	if time.Now().After(p.skipMullvadUntil) {
		status, err := mullvadStatus(iface)
		if err == nil {
			server := mullvadServer(status)
			if strings.HasPrefix(status, "You are connected to Mullvad") {
				return egressResult{ok: true, server: server}
			}
			return egressResult{violation: true, server: server, err: fmt.Errorf("traffic is not leaving through Mullvad")}
		}
		p.skipMullvadUntil = time.Now().Add(mullvadCheckSkip)
	}
	services := []func(string) string{
		func(i string) string { return strings.TrimSpace(curlVia(i, "https://api.country.is", jsonCountry)) },
		func(i string) string { return strings.TrimSpace(curlVia(i, "https://ipinfo.io/country", nil)) },
	}
	p.turn++
	for k := 0; k < len(services); k++ {
		country := services[(p.turn+k)%len(services)](iface)
		switch {
		case country == "RO":
			return egressResult{ok: true}
		case country != "":
			return egressResult{violation: true, err: fmt.Errorf("egress geolocated outside Romania (%s)", country)}
		}
	}
	return egressResult{err: fmt.Errorf("Mullvad egress check failed")}
}

func mullvadStatus(iface string) (string, error) {
	gatewayOut, err := exec.Command("sh", "-c", "ip -4 route show default | awk 'NR==1 {print $3}'").Output()
	if err != nil || strings.TrimSpace(string(gatewayOut)) == "" {
		return "", fmt.Errorf("could not find upstream DNS gateway")
	}
	dns := strings.TrimSpace(string(gatewayOut))
	dnsCtx, cancelDNS := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelDNS()
	lookup, err := exec.CommandContext(dnsCtx, "busybox", "nslookup", "am.i.mullvad.net", dns).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("could not resolve Mullvad status through upstream DNS")
	}
	ip := lastIPv4(string(lookup))
	if ip == "" {
		return "", fmt.Errorf("upstream DNS returned no Mullvad status address")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "curl", "-4", "--interface", iface,
		"--resolve", "am.i.mullvad.net:443:"+ip, "--connect-timeout", "3", "--max-time", "6",
		"-fsS", "https://am.i.mullvad.net/connected").Output()
	if err != nil {
		return "", fmt.Errorf("Mullvad egress check failed")
	}
	return strings.TrimSpace(string(out)), nil
}

func curlVia(iface, url string, parse func(string) string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "curl", "-4", "--interface", iface,
		"--connect-timeout", "3", "--max-time", "6", "-fsS", url).Output()
	if err != nil {
		return ""
	}
	if parse != nil {
		return parse(string(out))
	}
	return string(out)
}

func jsonCountry(body string) string {
	var v struct {
		Country string `json:"country"`
	}
	if json.Unmarshal([]byte(body), &v) != nil {
		return ""
	}
	return strings.TrimSpace(v.Country)
}

func mullvadServer(status string) string {
	const marker = "(server "
	start := strings.Index(status, marker)
	if start < 0 {
		return ""
	}
	server := status[start+len(marker):]
	if end := strings.Index(server, ")"); end >= 0 {
		server = server[:end]
	}
	return strings.TrimSpace(server)
}

func lastIPv4(text string) string {
	var found string
	for _, field := range strings.Fields(text) {
		candidate := strings.TrimSpace(field)
		if ip := net.ParseIP(candidate); ip != nil && strings.Contains(candidate, ".") {
			found = candidate
		}
	}
	return found
}

func healthIssues(st State) []HealthIssue {
	issues := make([]HealthIssue, 0)
	if !st.HotspotRunning {
		issues = append(issues, HealthIssue{Code: "hotspot-down", Severity: "critical", Title: "Hotspot is down", Detail: "hostapd or dnsmasq is not running.", Action: "restart-hotspot"})
	}
	if st.Uplink.Checked && !st.Uplink.Internet {
		detail := fmt.Sprintf("%s cannot reach the internet, so nothing can leave the Pi. Check the cable or router.", st.Uplink.Interface)
		if !st.Uplink.LinkUp {
			detail = fmt.Sprintf("%s has no link. Check the cable or router.", st.Uplink.Interface)
		}
		issues = append(issues, HealthIssue{Code: "uplink-offline", Severity: "critical", Title: "The Pi has no internet", Detail: detail})
	}
	if a := st.MullvadAccount; a != nil && a.DaysLeft != nil && *a.DaysLeft <= 7 {
		days := *a.DaysLeft
		sev, title := "warning", fmt.Sprintf("Mullvad time runs out in %d days", days)
		switch {
		case days < 0:
			sev, title = "critical", "Mullvad subscription has expired"
		case days <= 1:
			sev, title = "critical", "Mullvad time runs out tomorrow"
			if days == 0 {
				title = "Mullvad time runs out today"
			}
		}
		issues = append(issues, HealthIssue{Code: "mullvad-expiring", Severity: sev, Title: title, Detail: "Add time on mullvad.net. When it runs out, the Romanian tunnel stops and the hotspot has no internet.", Action: "mullvad-renew"})
	}
	if st.Mode == ModeMullvad {
		switch {
		case !st.VPNHealth.CountryAllowed:
			detail := "The saved or active Mullvad relay is outside the required Romania-only policy. Internet is blocked until a Romanian relay works."
			if st.VPNHealth.Relay != "" {
				detail = fmt.Sprintf("Relay %s violates the Romania-only policy. Internet is blocked until a Romanian relay works.", st.VPNHealth.Relay)
			}
			issues = append(issues, HealthIssue{Code: "vpn-country-blocked", Severity: "critical", Title: "Non-Romanian VPN route blocked", Detail: detail, Action: "repair-vpn"})
		case !st.VPNHealth.InterfaceUp:
			detail := st.VPNHealth.Error
			if st.VPNHealth.LastRepairError != "" {
				detail = st.VPNHealth.LastRepairError
			}
			issues = append(issues, HealthIssue{Code: "vpn-interface-down", Severity: "critical", Title: "Romania-only internet is blocked", Detail: detail, Action: "repair-vpn"})
		case !st.VPNHealth.HandshakeHealthy:
			detail := st.VPNHealth.Error
			if st.VPNHealth.HandshakeAgeSeconds != nil {
				detail = fmt.Sprintf("Latest WireGuard handshake is %d seconds old.", *st.VPNHealth.HandshakeAgeSeconds)
			}
			if st.VPNHealth.LastRepairError != "" {
				detail = st.VPNHealth.LastRepairError
			}
			issues = append(issues, HealthIssue{Code: "vpn-handshake-stale", Severity: "critical", Title: "Mullvad handshake is stale", Detail: detail, Action: "repair-vpn"})
		case !st.VPNHealth.EgressOK:
			issues = append(issues, HealthIssue{Code: "vpn-egress-failed", Severity: "critical", Title: "Mullvad internet check failed", Detail: st.VPNHealth.Error, Action: "repair-vpn"})
		}
	} else if !st.ProxyRunning {
		issues = append(issues, HealthIssue{Code: "proxy-down", Severity: "critical", Title: "Residential proxy is down", Detail: "The selected hotspot route is not running.", Action: "restart-hotspot"})
	}
	if temp := st.DeviceMetrics.Thermal.TemperatureCelsius; st.DeviceMetrics.Thermal.Available && temp >= 75 {
		severity := "warning"
		if temp >= 82 {
			severity = "critical"
		}
		issues = append(issues, HealthIssue{Code: "temperature-high", Severity: severity, Title: "Pi temperature is high", Detail: fmt.Sprintf("CPU temperature is %.1f°C; check airflow and cooling.", temp)})
	}
	if st.DeviceMetrics.Thermal.Throttled {
		issues = append(issues, HealthIssue{Code: "thermal-throttling", Severity: "critical", Title: "Pi is currently throttled", Detail: "The current Raspberry Pi throttle flags are active."})
	}
	return issues
}

// LoadConfig reads Config from baseDir/config/env.
func LoadConfig(baseDir string) (Config, error) {
	f, err := os.Open(filepath.Join(baseDir, "config", "env"))
	if err != nil {
		return Config{}, err
	}
	defer f.Close()
	return parseEnv(f), nil
}

// ErrInvalidConfig marks a save rejected because of the submitted values.
var ErrInvalidConfig = errors.New("invalid config")

// SaveConfig updates the known keys in baseDir/config/env, preserving every
// other line. A key with no line yet is appended when it has a value, so a
// save never reports success while dropping a setting.
// Empty Password keeps the previously stored value.
func SaveConfig(baseDir string, c Config) error {
	path := filepath.Join(baseDir, "config", "env")
	if strings.TrimSpace(c.Password) == "" {
		if prev, err := LoadConfig(baseDir); err == nil {
			c.Password = prev.Password
		}
	}
	lines, err := readLines(path)
	if err != nil {
		return err
	}
	updates := []struct{ key, val string }{
		{"SSID", c.SSID},
		{"PASSWORD", c.Password},
		{"HOTSPOT_IP", c.HotspotIP},
		{"DHCP_START", c.DHCPStart},
		{"DHCP_END", c.DHCPEnd},
	}
	// One value per line: a line break would add arbitrary extra entries to
	// the env file the hotspot scripts read.
	for _, u := range updates {
		if strings.ContainsAny(u.val, "\r\n\x00") {
			return fmt.Errorf("%w: %s must be a single line", ErrInvalidConfig, u.key)
		}
	}
	for _, u := range updates {
		found := false
		for i, line := range lines {
			if strings.HasPrefix(strings.TrimSpace(line), u.key+"=") {
				lines[i] = u.key + "=" + u.val
				found = true
			}
		}
		if !found && u.val != "" {
			lines = append(lines, u.key+"="+u.val)
		}
	}
	return writeLines(path, lines)
}

func parseEnv(f *os.File) (c Config) {
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || line[0] == '#' {
			continue
		}
		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}
		k, v := strings.TrimSpace(line[:idx]), strings.TrimSpace(line[idx+1:])
		switch k {
		case "SSID":
			c.SSID = v
		case "PASSWORD":
			c.Password = v
		case "HOTSPOT_IP":
			c.HotspotIP = v
		case "DHCP_START":
			c.DHCPStart = v
		case "DHCP_END":
			c.DHCPEnd = v
		case "WG_IF":
			c.WGInterface = v
		case "WAN_IF":
			c.WANInterface = v
		}
	}
	return c
}

func readLines(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var lines []string
	s := bufio.NewScanner(f)
	for s.Scan() {
		lines = append(lines, s.Text())
	}
	return lines, s.Err()
}

func writeLines(path string, lines []string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	for _, line := range lines {
		if _, err := f.WriteString(line + "\n"); err != nil {
			_ = f.Close()
			_ = os.Remove(tmp)
			return err
		}
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// ReadShellCached returns a short-lived cached snapshot for SPA shell and SSE polls.
// Concurrent callers share one in-flight Read (singleflight).
func (r *Reader) ReadShellCached() (State, error) {
	r.cacheMu.Lock()
	if !r.shell.at.IsZero() && time.Since(r.shell.at) < shellStateCacheTTL {
		st, err := r.shell.state, r.shell.err
		r.cacheMu.Unlock()
		return st, err
	}
	if ch := r.shellCh; ch != nil {
		r.cacheMu.Unlock()
		<-ch
		r.cacheMu.Lock()
		st, err := r.shell.state, r.shell.err
		r.cacheMu.Unlock()
		return st, err
	}
	ch := make(chan struct{})
	r.shellCh = ch
	r.cacheMu.Unlock()

	st, err := r.Read()

	r.cacheMu.Lock()
	r.shell = shellCache{at: time.Now(), state: st, err: err}
	r.shellCh = nil
	close(ch)
	r.cacheMu.Unlock()
	return st, err
}
