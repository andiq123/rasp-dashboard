// Package alerts pushes problems to the owner's iPhone through Bark
// (https://bark.day.app, or a self-hosted bark-server). An alert fires once
// after its condition has held for a grace period, and sends a quiet
// "resolved" note when it clears, so a flapping check never floods the phone.
package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// DefaultServer is Bark's public push server.
const DefaultServer = "https://api.day.app"

// Settings is what the owner configures.
type Settings struct {
	Enabled bool   `json:"enabled"`
	Server  string `json:"server"`
	Key     string `json:"key"`
	// Muted lists event categories the owner turned off; everything else is on,
	// so categories added later are delivered by default.
	Muted []string `json:"muted,omitempty"`
}

// Event categories, as shown in the dashboard's checklist.
const (
	EventInternet = "internet" // uplink, VPN, leaks, hotspot
	EventMullvad  = "mullvad"  // subscription running out
	EventApps     = "apps"     // crash loops
	EventLinks    = "links"    // public links down, certificates
	EventPi       = "pi"       // temperature, disk
)

var Events = []string{EventInternet, EventMullvad, EventApps, EventLinks, EventPi}

func (s Settings) wants(category string) bool {
	for _, m := range s.Muted {
		if m == category {
			return false
		}
	}
	return true
}

// Alert is one condition that is currently true.
type Alert struct {
	Key      string
	Category string
	Title    string
	Body     string
	// Urgent alerts are time-sensitive: they break through Focus modes.
	Urgent bool
	// Grace is how long the condition must hold before the phone is told.
	Grace time.Duration
	// NoResolve skips the "resolved" note (for slow-moving reminders).
	NoResolve bool
}

// Status is what the dashboard shows.
type Status struct {
	Settings
	Active   []string  `json:"active"`
	LastSent time.Time `json:"last_sent,omitzero"`
	LastErr  string    `json:"last_error,omitempty"`
}

type pending struct {
	alert Alert
	since time.Time
	sent  bool
}

type Engine struct {
	path   string
	client *http.Client

	mu       sync.Mutex
	settings Settings
	pending  map[string]*pending
	lastSent time.Time
	lastErr  string
}

func New(path string) *Engine {
	e := &Engine{path: path, client: &http.Client{Timeout: 10 * time.Second}, pending: map[string]*pending{}}
	b, err := os.ReadFile(path)
	if err != nil {
		return e
	}
	_ = json.Unmarshal(b, &e.settings)
	// Settings from an older channel (no Bark key) start switched off, and the
	// file is rewritten so nothing from that channel stays on disk.
	if e.settings.Key == "" {
		e.settings = Settings{Muted: e.settings.Muted}
		if clean, err := json.MarshalIndent(e.settings, "", "  "); err == nil && !bytes.Equal(clean, b) {
			_ = os.WriteFile(path, clean, 0o600)
		}
	}
	return e
}

func (e *Engine) Status() Status {
	e.mu.Lock()
	defer e.mu.Unlock()
	st := Status{Settings: e.settings, LastSent: e.lastSent, LastErr: e.lastErr, Active: []string{}}
	for _, p := range e.pending {
		if p.sent {
			st.Active = append(st.Active, p.alert.Title)
		}
	}
	return st
}

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9]{8,64}$`)

// ParseTarget accepts a bare device key or the URL the Bark app shows
// (https://api.day.app/<key>/…) and returns the server and key.
func ParseTarget(server, key string) (string, string, error) {
	server, key = strings.TrimSpace(server), strings.TrimSpace(key)
	if strings.Contains(key, "/") {
		u, err := url.Parse(key)
		if err != nil || u.Host == "" {
			return "", "", errors.New("paste the key or the URL the Bark app shows")
		}
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		server, key = u.Scheme+"://"+u.Host, parts[0]
	}
	if server == "" {
		server = DefaultServer
	}
	u, err := url.Parse(server)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", "", errors.New("the Bark server must be an http(s) address")
	}
	if key != "" && !keyPattern.MatchString(key) {
		return "", "", errors.New("that does not look like a Bark key; copy it from the Bark app")
	}
	return strings.TrimRight(u.String(), "/"), key, nil
}

func (e *Engine) SetSettings(s Settings) error {
	server, key, err := ParseTarget(s.Server, s.Key)
	if err != nil {
		return err
	}
	s.Server, s.Key = server, key
	known := map[string]bool{}
	for _, ev := range Events {
		known[ev] = true
	}
	muted := []string{}
	for _, m := range s.Muted {
		if known[m] {
			muted = append(muted, m)
		}
	}
	s.Muted = muted
	if s.Enabled && s.Key == "" {
		return errors.New("add your Bark key before turning alerts on")
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	if err := os.MkdirAll(filepath.Dir(e.path), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(e.path, b, 0o600); err != nil {
		return err
	}
	e.mu.Lock()
	e.settings = s
	e.mu.Unlock()
	return nil
}

// Evaluate takes every condition that is true right now and sends what is due.
// A condition only counts as sent once it was really delivered, so turning
// alerts (or a category) on later still reports problems that are already open.
func (e *Engine) Evaluate(ctx context.Context, now time.Time, current []Alert) {
	e.mu.Lock()
	s := e.settings
	deliver := func(a Alert) bool { return s.Enabled && s.Key != "" && s.wants(a.Category) }
	seen := map[string]bool{}
	var send []push
	for _, a := range current {
		seen[a.Key] = true
		p, ok := e.pending[a.Key]
		if !ok {
			p = &pending{since: now}
			e.pending[a.Key] = p
		}
		p.alert = a
		if !p.sent && now.Sub(p.since) >= a.Grace && deliver(a) {
			p.sent = true
			level := "active"
			if a.Urgent {
				level = "timeSensitive"
			}
			send = append(send, push{Title: a.Title, Body: a.Body, Level: level})
		}
	}
	for key, p := range e.pending {
		if seen[key] {
			continue
		}
		delete(e.pending, key)
		if p.sent && !p.alert.NoResolve && deliver(p.alert) {
			// Resolved notes land quietly in Notification Center.
			send = append(send, push{Title: "Resolved: " + p.alert.Title, Body: "Back to normal.", Level: "passive"})
		}
	}
	e.mu.Unlock()
	for _, m := range send {
		e.record(e.post(ctx, s.Server, s.Key, m))
	}
}

// Test sends a sample notification with the given (or saved) server and key.
func (e *Engine) Test(ctx context.Context, server, key string) error {
	saved := e.Status().Settings
	if strings.TrimSpace(key) == "" {
		server, key = saved.Server, saved.Key
	}
	server, key, err := ParseTarget(server, key)
	if err != nil {
		return err
	}
	if key == "" {
		return errors.New("add your Bark key first")
	}
	err = e.post(ctx, server, key, push{Title: "FireWifi alerts work", Body: "You will get a notification here when something on the Pi needs you.", Level: "active"})
	e.record(err)
	return err
}

func (e *Engine) record(err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err != nil {
		e.lastErr = err.Error()
		return
	}
	e.lastSent, e.lastErr = time.Now(), ""
}

type push struct {
	Title string
	Body  string
	Level string // active, timeSensitive, passive
}

// post uses Bark's JSON API (POST /push), so any Unicode title survives.
func (e *Engine) post(ctx context.Context, server, key string, m push) error {
	body, _ := json.Marshal(map[string]string{
		"device_key": key,
		"title":      m.Title,
		"body":       m.Body,
		"level":      m.Level,
		"group":      "FireWifi",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server+"/push", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach Bark: %w", err)
	}
	defer resp.Body.Close()
	var reply struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&reply)
	if resp.StatusCode >= 300 || (reply.Code != 0 && reply.Code != 200) {
		if reply.Message != "" {
			return fmt.Errorf("Bark: %s", reply.Message)
		}
		return fmt.Errorf("Bark answered %s", resp.Status)
	}
	return nil
}
