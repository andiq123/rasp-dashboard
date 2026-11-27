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

const usageSaveEvery = time.Minute

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
	if !t.loaded {
		t.loaded = true
		if b, err := os.ReadFile(r.usagePath()); err == nil {
			_ = json.Unmarshal(b, &t.usage)
		}
	}
	total, ok := hotspotBytes()
	t.usage = advanceUsage(t.usage, mode == ModeResidential, total, ok, t.last, t.hasLast, now)
	if ok {
		t.last, t.hasLast = total, true
	}
	if now.Sub(t.savedAt) >= usageSaveEvery || !t.usage.Active && t.usage.SessionBytes > 0 {
		if b, err := json.MarshalIndent(t.usage, "", "  "); err == nil && os.WriteFile(r.usagePath(), b, 0o600) == nil {
			t.savedAt = now
		}
	}
	return t.usage
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
		client.Transport = &http.Transport{DialContext: wanDialer(wg, 5*time.Second).DialContext}
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
