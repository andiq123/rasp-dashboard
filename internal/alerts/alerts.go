// Package alerts pushes problems to the owner's phone through ntfy
// (https://ntfy.sh or a self-hosted server). An alert fires once after its
// condition has held for a grace period, and sends a "resolved" note when the
// condition clears, so a flapping check never floods the phone.
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
	"strings"
	"sync"
	"time"
)

// Settings is what the owner configures.
type Settings struct {
	Enabled bool   `json:"enabled"`
	NtfyURL string `json:"ntfy_url"`
}

// Alert is one condition that is currently true.
type Alert struct {
	Key      string
	Title    string
	Body     string
	Priority string // ntfy priority: min, low, default, high, urgent
	Tags     string // ntfy emoji tags, comma separated
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
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &e.settings)
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

// ValidateURL accepts an http(s) ntfy topic URL such as https://ntfy.sh/my-topic.
func ValidateURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || strings.Trim(u.Path, "/") == "" {
		return "", errors.New("use a topic URL like https://ntfy.sh/your-topic")
	}
	return u.String(), nil
}

func (e *Engine) SetSettings(s Settings) error {
	clean, err := ValidateURL(s.NtfyURL)
	if err != nil {
		return err
	}
	s.NtfyURL = clean
	if s.Enabled && s.NtfyURL == "" {
		return errors.New("add a topic URL before turning alerts on")
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
func (e *Engine) Evaluate(ctx context.Context, now time.Time, current []Alert) {
	e.mu.Lock()
	s := e.settings
	seen := map[string]bool{}
	var send []Alert
	for _, a := range current {
		seen[a.Key] = true
		p, ok := e.pending[a.Key]
		if !ok {
			p = &pending{since: now}
			e.pending[a.Key] = p
		}
		p.alert = a
		if !p.sent && now.Sub(p.since) >= a.Grace {
			p.sent = true
			send = append(send, a)
		}
	}
	for key, p := range e.pending {
		if seen[key] {
			continue
		}
		delete(e.pending, key)
		if p.sent && !p.alert.NoResolve {
			send = append(send, Alert{Key: key, Title: "Resolved: " + p.alert.Title, Body: "Back to normal.", Priority: "low", Tags: "white_check_mark"})
		}
	}
	e.mu.Unlock()
	if !s.Enabled || s.NtfyURL == "" {
		return
	}
	for _, a := range send {
		e.record(e.post(ctx, s.NtfyURL, a))
	}
}

// Test sends a sample notification with the given (or saved) URL.
func (e *Engine) Test(ctx context.Context, rawURL string) error {
	target, err := ValidateURL(rawURL)
	if err != nil {
		return err
	}
	if target == "" {
		target = e.Status().NtfyURL
	}
	if target == "" {
		return errors.New("add a topic URL first")
	}
	err = e.post(ctx, target, Alert{Title: "FireWifi alerts work", Body: "You will get a notification here when something on the Pi needs you.", Priority: "default", Tags: "tada"})
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

var priorities = map[string]int{"min": 1, "low": 2, "default": 3, "high": 4, "urgent": 5}

// post publishes as JSON (POST to the server root with the topic in the body),
// so titles with any Unicode survive; headers would mangle them.
func (e *Engine) post(ctx context.Context, target string, a Alert) error {
	u, err := url.Parse(target)
	if err != nil {
		return err
	}
	path := strings.Trim(u.Path, "/")
	base, topic := "", path
	if i := strings.LastIndex(path, "/"); i >= 0 {
		base, topic = path[:i], path[i+1:]
	}
	u.Path, u.RawQuery = "/"+base, ""
	msg := map[string]any{"topic": topic, "title": a.Title, "message": a.Body}
	if p, ok := priorities[a.Priority]; ok {
		msg["priority"] = p
	}
	if a.Tags != "" {
		msg["tags"] = strings.Split(a.Tags, ",")
	}
	body, _ := json.Marshal(msg)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach ntfy: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("ntfy answered %s", resp.Status)
	}
	return nil
}
