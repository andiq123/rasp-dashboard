package state

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	usageSaveEvery = time.Minute
	// After this long the dashboard asks once whether the saved balance still matches IPRoyal.
	balanceStaleAfter = 7 * 24 * time.Hour
	maxBalanceBytes   = 100_000 * 1e9
)

// ResidentialUsage is Wi-Fi traffic sent through the paid residential proxy:
// the current session and the calendar month. Counted from the hotspot
// interface while residential mode is on, so it is a close estimate of what
// the proxy bills.
type ResidentialUsage struct {
	Active       bool      `json:"active"`
	SessionStart time.Time `json:"session_start,omitzero"`
	SessionBytes uint64    `json:"session_bytes"`
	Month        string    `json:"month"`
	MonthBytes   uint64    `json:"month_bytes"`
	// TotalBytes never resets; the balance counts down against it.
	TotalBytes uint64 `json:"total_bytes"`
	// Balance as the owner entered it (from the IPRoyal dashboard), when, and
	// TotalBytes at that moment. Remaining = balance − bytes used since.
	BalanceBytes   uint64    `json:"balance_bytes,omitempty"`
	BalanceSetAt   time.Time `json:"balance_set_at,omitzero"`
	BalanceTotalAt uint64    `json:"balance_total_at,omitempty"`
	// Derived for the dashboard; not meaningful on disk.
	RemainingBytes *uint64 `json:"remaining_bytes,omitempty"`
	BalanceStale   bool    `json:"balance_stale,omitempty"`
}

// withBalance fills the derived balance fields.
func (u ResidentialUsage) withBalance(now time.Time) ResidentialUsage {
	u.RemainingBytes, u.BalanceStale = nil, false
	if u.BalanceSetAt.IsZero() {
		return u
	}
	used := u.TotalBytes - u.BalanceTotalAt
	left := uint64(0)
	if used < u.BalanceBytes {
		left = u.BalanceBytes - used
	}
	u.RemainingBytes = &left
	u.BalanceStale = now.Sub(u.BalanceSetAt) > balanceStaleAfter
	return u
}

// SetResidentialBalance records the balance shown in the IPRoyal dashboard;
// counting down starts from now.
func (r *Reader) SetResidentialBalance(bytes uint64) (ResidentialUsage, error) {
	if bytes > maxBalanceBytes {
		return ResidentialUsage{}, errors.New("that balance is too large")
	}
	now := time.Now()
	t := &r.usage
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ensureLoaded(r.usagePath())
	t.usage.BalanceBytes, t.usage.BalanceSetAt, t.usage.BalanceTotalAt = bytes, now, t.usage.TotalBytes
	if err := t.save(r.usagePath(), now); err != nil {
		return ResidentialUsage{}, err
	}
	return t.usage.withBalance(now), nil
}

func (t *usageTracker) ensureLoaded(path string) {
	if t.loaded {
		return
	}
	t.loaded = true
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &t.usage)
	}
}

func (t *usageTracker) save(path string, now time.Time) error {
	disk := t.usage
	disk.RemainingBytes, disk.BalanceStale = nil, false
	b, err := json.MarshalIndent(disk, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return err
	}
	t.savedAt = now
	return nil
}

type usageTracker struct {
	mu      sync.Mutex
	loaded  bool
	usage   ResidentialUsage
	last    uint64 // hotspot rx+tx at the previous sample
	hasLast bool
	savedAt time.Time
}

func (r *Reader) usagePath() string {
	return filepath.Join(r.BaseDir, "config", "residential-usage.json")
}

// trackResidential adds hotspot bytes to the session and month while
// residential mode is on. Safe to call on every Read.
func (r *Reader) trackResidential(mode string, now time.Time) ResidentialUsage {
	t := &r.usage
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ensureLoaded(r.usagePath())
	total, ok := hotspotBytes()
	t.usage = advanceUsage(t.usage, mode == ModeResidential, total, ok, t.last, t.hasLast, now)
	if ok {
		t.last, t.hasLast = total, true
	}
	if now.Sub(t.savedAt) >= usageSaveEvery {
		_ = t.save(r.usagePath(), now)
	}
	return t.usage.withBalance(now)
}

// advanceUsage is the pure accounting step, separated for tests.
func advanceUsage(u ResidentialUsage, residential bool, total uint64, ok bool, last uint64, hasLast bool, now time.Time) ResidentialUsage {
	month := now.Format("2006-01")
	if u.Month != month {
		u.Month, u.MonthBytes = month, 0
	}
	switch {
	case residential && !u.Active:
		u.Active, u.SessionStart, u.SessionBytes = true, now, 0
	case !residential && u.Active:
		u.Active = false // keep the finished session's numbers for the "back on Mullvad" note
	}
	if residential && ok && hasLast {
		delta := total - last
		if total < last { // interface recreated: counters restarted
			delta = total
		}
		u.SessionBytes += delta
		u.MonthBytes += delta
		u.TotalBytes += delta
	}
	return u
}

func hotspotBytes() (uint64, bool) {
	read := func(name string) (uint64, bool) {
		b, err := os.ReadFile(filepath.Join("/sys/class/net", hotspotInterface, "statistics", name))
		if err != nil {
			return 0, false
		}
		v, err := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
		return v, err == nil
	}
	rx, ok1 := read("rx_bytes")
	tx, ok2 := read("tx_bytes")
	return rx + tx, ok1 && ok2
}

// Exit is the public address Wi-Fi traffic currently leaves from.
type Exit struct {
	IP      string `json:"ip"`
	Country string `json:"country"`
}

const exitLookupURL = "https://api.country.is"

// LookupExit asks a geo service which address Wi-Fi traffic leaves from:
// through the tunnel in Mullvad mode, through the proxy in residential mode.
func (r *Reader) LookupExit(ctx context.Context, mode string) (Exit, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	switch mode {
	case ModeResidential:
		proxyURL, err := r.residentialProxyURL()
		if err != nil {
			return Exit{}, err
		}
		client.Transport = &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	default:
		cfg, _ := LoadConfig(r.BaseDir)
		wg := cfg.WGInterface
		if wg == "" {
			wg = "mullvad-wg"
		}
		d := wanDialer(wg, 5*time.Second)
		// IPv4, so the address in the notification is the familiar dotted form.
		client.Transport = &http.Transport{DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
			return d.DialContext(ctx, "tcp4", addr)
		}}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, exitLookupURL, nil)
	if err != nil {
		return Exit{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return Exit{}, err
	}
	defer resp.Body.Close()
	var out Exit
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.IP == "" {
		return Exit{}, errors.New("exit lookup gave no address")
	}
	return out, nil
}

// residentialProxyURL builds the proxy address from config/proxy/residential.env
// (PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS; http-connect proxies only).
func (r *Reader) residentialProxyURL() (*url.URL, error) {
	f, err := os.Open(filepath.Join(r.BaseDir, "config", "proxy", "residential.env"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	env := map[string]string{}
	s := bufio.NewScanner(f)
	for s.Scan() {
		k, v, ok := strings.Cut(strings.TrimSpace(s.Text()), "=")
		if ok && !strings.HasPrefix(k, "#") {
			env[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
		}
	}
	if t := env["PROXY_TYPE"]; t != "" && t != "http-connect" {
		return nil, errors.New("exit lookup supports http-connect proxies only")
	}
	if env["PROXY_HOST"] == "" || env["PROXY_PORT"] == "" {
		return nil, errors.New("residential proxy is not configured")
	}
	return &url.URL{Scheme: "http", Host: net.JoinHostPort(env["PROXY_HOST"], env["PROXY_PORT"]), User: url.UserPassword(env["PROXY_USER"], env["PROXY_PASS"])}, nil
}
