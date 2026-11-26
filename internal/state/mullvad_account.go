package state

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	mullvadAPI        = "https://api.mullvad.net"
	accountTTL        = time.Hour
	accountFailureTTL = 10 * time.Minute
	accountFileName   = "mullvad.account"
)

// MullvadAccount is the subscription status shown on the dashboard. The account
// number itself never leaves the Pi; only a masked form is returned.
type MullvadAccount struct {
	Configured bool   `json:"configured"`
	Masked     string `json:"masked,omitempty"`
	ExpiresAt  string `json:"expires_at,omitempty"`
	DaysLeft   *int   `json:"days_left,omitempty"`
	CheckedAt  string `json:"checked_at,omitempty"`
	Error      string `json:"error,omitempty"`
}

type accountCache struct {
	mu       sync.Mutex
	number   string
	at       time.Time
	fetching bool
	expiry   time.Time
	err      string
}

var errBadAccount = errors.New("Mullvad did not accept this account number")

func (r *Reader) accountPath() string { return filepath.Join(r.BaseDir, "config", accountFileName) }

// normalizeAccount keeps digits only; Mullvad account numbers have 16.
func normalizeAccount(s string) (string, error) {
	var b strings.Builder
	for _, c := range s {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	if b.Len() != 16 {
		return "", errors.New("A Mullvad account number has 16 digits")
	}
	return b.String(), nil
}

func maskAccount(n string) string {
	if len(n) < 4 {
		return ""
	}
	return "•••• •••• •••• " + n[len(n)-4:]
}

// ReadMullvadAccount never blocks on the network: a stale value refreshes in
// the background and the last known result is returned meanwhile.
func (r *Reader) ReadMullvadAccount() MullvadAccount {
	c := &r.account
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.number == "" {
		b, err := os.ReadFile(r.accountPath())
		if err != nil {
			return MullvadAccount{}
		}
		c.number = strings.TrimSpace(string(b))
	}
	ttl := accountTTL
	if c.err != "" {
		ttl = accountFailureTTL
	}
	if !c.fetching && time.Since(c.at) >= ttl {
		c.fetching = true
		number, iface := c.number, r.wanInterface()
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			expiry, err := fetchMullvadExpiry(ctx, number, iface)
			c.mu.Lock()
			defer c.mu.Unlock()
			c.fetching, c.at = false, time.Now()
			if c.number != number {
				return // account changed meanwhile
			}
			if err != nil {
				c.err = err.Error()
				return
			}
			c.expiry, c.err = expiry, ""
		}()
	}
	return c.view()
}

func (c *accountCache) view() MullvadAccount {
	a := MullvadAccount{Configured: c.number != "", Masked: maskAccount(c.number), Error: c.err}
	if !c.at.IsZero() {
		a.CheckedAt = c.at.Format(time.RFC3339)
	}
	if !c.expiry.IsZero() {
		a.ExpiresAt = c.expiry.Format(time.RFC3339)
		days := int(math.Floor(time.Until(c.expiry).Hours() / 24))
		a.DaysLeft = &days
	}
	return a
}

// SetMullvadAccount checks the number with Mullvad before saving it.
func (r *Reader) SetMullvadAccount(ctx context.Context, raw string) (MullvadAccount, error) {
	number, err := normalizeAccount(raw)
	if err != nil {
		return MullvadAccount{}, err
	}
	expiry, err := fetchMullvadExpiry(ctx, number, r.wanInterface())
	if err != nil {
		return MullvadAccount{}, err
	}
	path := r.accountPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return MullvadAccount{}, err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(number+"\n"), 0o600); err != nil {
		return MullvadAccount{}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return MullvadAccount{}, err
	}
	c := &r.account
	c.mu.Lock()
	defer c.mu.Unlock()
	c.number, c.expiry, c.err, c.at = number, expiry, "", time.Now()
	return c.view(), nil
}

// ClearMullvadAccount forgets the account number.
func (r *Reader) ClearMullvadAccount() error {
	if err := os.Remove(r.accountPath()); err != nil && !os.IsNotExist(err) {
		return err
	}
	c := &r.account
	c.mu.Lock()
	c.number, c.expiry, c.err, c.at = "", time.Time{}, "", time.Time{}
	c.mu.Unlock()
	return nil
}

func (r *Reader) wanInterface() string {
	cfg, _ := LoadConfig(r.BaseDir)
	if cfg.WANInterface != "" {
		return cfg.WANInterface
	}
	return defaultWANInterface
}

// fetchMullvadExpiry exchanges the account number for a short-lived token and
// reads the account expiry, over the physical uplink (works with the VPN down).
func fetchMullvadExpiry(ctx context.Context, number, iface string) (time.Time, error) {
	client := &http.Client{
		Timeout:   15 * time.Second,
		Transport: &http.Transport{DialContext: wanDialer(iface, 5*time.Second).DialContext, TLSHandshakeTimeout: 8 * time.Second},
	}
	body, _ := json.Marshal(map[string]string{"account_number": number})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, mullvadAPI+"/auth/v1/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return time.Time{}, errors.New("Could not reach Mullvad over Ethernet")
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusBadRequest || res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusNotFound {
		return time.Time{}, errBadAccount
	}
	if res.StatusCode != http.StatusOK {
		return time.Time{}, fmt.Errorf("Mullvad sign-in failed (HTTP %d)", res.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tok); err != nil || tok.AccessToken == "" {
		return time.Time{}, errors.New("Mullvad returned no sign-in token")
	}
	req, _ = http.NewRequestWithContext(ctx, http.MethodGet, mullvadAPI+"/accounts/v1/accounts/me", nil)
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	res2, err := client.Do(req)
	if err != nil {
		return time.Time{}, errors.New("Could not reach Mullvad over Ethernet")
	}
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusOK {
		return time.Time{}, fmt.Errorf("Mullvad account lookup failed (HTTP %d)", res2.StatusCode)
	}
	var acct struct {
		Expiry string `json:"expiry"`
	}
	if err := json.NewDecoder(res2.Body).Decode(&acct); err != nil {
		return time.Time{}, errors.New("Mullvad returned an unreadable account")
	}
	expiry, err := time.Parse(time.RFC3339, acct.Expiry)
	if err != nil {
		return time.Time{}, errors.New("Mullvad returned no expiry date")
	}
	return expiry, nil
}
