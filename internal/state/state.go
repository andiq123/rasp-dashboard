package state

import (
	"bufio"
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
)

func ValidMode(m string) bool {
	return m == ModeMullvad || m == ModeResidential
}

// State is the full runtime snapshot of the system.
type State struct {
	Mode           string        `json:"mode"`
	HotspotRunning bool          `json:"hotspot_running"`
	SSID           string        `json:"ssid"`
	HotspotIP      string        `json:"hotspot_ip"`
	DHCPStart      string        `json:"dhcp_start"`
	DHCPEnd        string        `json:"dhcp_end"`
	WGUp           bool          `json:"wg_up"`
	ProxyRunning   bool          `json:"proxy_running"`
	SyncroxRunning bool          `json:"syncrox_running"`
	DeviceMetrics  DeviceMetrics `json:"device_metrics"`
	GeneratedAt    string        `json:"generated_at"`
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
	ThrottleKnown      bool    `json:"throttle_known"`
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
	SSID        string `json:"ssid"`
	Password    string `json:"password"`
	HotspotIP   string `json:"hotspot_ip"`
	DHCPStart   string `json:"dhcp_start"`
	DHCPEnd     string `json:"dhcp_end"`
	WGInterface string `json:"-"`
}

const shellStateCacheTTL = 2 * time.Second

type shellCache struct {
	at    time.Time
	state State
	err   error
}

// Reader reads system state from disk and running processes.
type Reader struct {
	BaseDir string
	mu      sync.Mutex
	prev    metricsSample
	cacheMu sync.Mutex
	shell   shellCache
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
	return State{
		Mode:           mode,
		HotspotRunning: hostapdRunning && dnsmasqRunning,
		SSID:           cfg.SSID,
		HotspotIP:      cfg.HotspotIP,
		DHCPStart:      cfg.DHCPStart,
		DHCPEnd:        cfg.DHCPEnd,
		WGUp:           wgUp(cfg.WGInterface),
		ProxyRunning:   processRunning("redsocks.*redsocks-hotspot"),
		SyncroxRunning: portReachable("SYNCROX_PORT", "5090"),
		DeviceMetrics:  r.readDeviceMetrics(),
		GeneratedAt:    time.Now().Format(time.RFC3339),
	}, nil
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
			metrics.ThrottleKnown = true
			metrics.Throttled = value != 0
		}
	}
	return metrics
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

func portReachable(envKey, defaultPort string) bool {
	port := os.Getenv(envKey)
	if port == "" {
		port = defaultPort
	}
	if n, err := strconv.Atoi(port); err != nil || n <= 0 {
		return false
	}
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+port, portCheckTimeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
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

// SaveConfig updates only the known keys in baseDir/config/env, preserving all others.
func SaveConfig(baseDir string, c Config) error {
	path := filepath.Join(baseDir, "config", "env")
	lines, err := readLines(path)
	if err != nil {
		return err
	}
	updates := map[string]string{
		"SSID":       c.SSID,
		"PASSWORD":   c.Password,
		"HOTSPOT_IP": c.HotspotIP,
		"DHCP_START": c.DHCPStart,
		"DHCP_END":   c.DHCPEnd,
	}
	for i, line := range lines {
		for key, val := range updates {
			if strings.HasPrefix(line, key+"=") {
				lines[i] = key + "=" + val
				break
			}
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
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	for _, line := range lines {
		if _, err := f.WriteString(line + "\n"); err != nil {
			return err
		}
	}
	return nil
}

// ReadShellCached returns a short-lived cached snapshot for SPA shell and SSE polls.
func (r *Reader) ReadShellCached() (State, error) {
	r.cacheMu.Lock()
	if !r.shell.at.IsZero() && time.Since(r.shell.at) < shellStateCacheTTL {
		st, err := r.shell.state, r.shell.err
		r.cacheMu.Unlock()
		return st, err
	}
	r.cacheMu.Unlock()

	st, err := r.Read()
	r.cacheMu.Lock()
	r.shell = shellCache{at: time.Now(), state: st, err: err}
	r.cacheMu.Unlock()
	return st, err
}
