package server

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"firewifi/dashboard/internal/alerts"
)

const (
	uptimeInterval = 2 * time.Minute
	uptimeKeep     = 720 // 24 hours of checks
	certWarnDays   = 14
)

// LinkUptime is how a public link looks from the internet.
type LinkUptime struct {
	Group     string    `json:"group"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Up        bool      `json:"up"`
	Status    int       `json:"status,omitempty"`
	LatencyMS int       `json:"latency_ms,omitempty"`
	Error     string    `json:"error,omitempty"`
	CertDays  *int      `json:"cert_days,omitempty"`
	Uptime    float64   `json:"uptime_percent"`
	Checks    int       `json:"checks"`
	CheckedAt time.Time `json:"checked_at"`
	// Consecutive failed checks, so one blip does not page anyone.
	Failures int `json:"failures"`
}

type uptimeTracker struct {
	mu      sync.Mutex
	links   map[string]*LinkUptime
	history map[string][]bool
}

func (s *Server) watchLinks(ctx context.Context) {
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			s.checkLinks(ctx, client)
			timer.Reset(uptimeInterval)
		}
	}
}

func (s *Server) checkLinks(ctx context.Context, client *http.Client) {
	svcs, err := s.Deploy.ListServices(ctx, "")
	if err != nil {
		return
	}
	t := &s.uptime
	live := map[string]bool{}
	for _, svc := range svcs {
		// A stopped app's link is expected to be down: no checks, no alerts.
		if svc.PublicURL == "" || !svc.Running {
			continue
		}
		key := svc.Group + "/" + svc.Slug
		live[key] = true
		target := strings.TrimRight(svc.PublicURL, "/") + svc.PublicPath
		res := probeLink(ctx, client, target)
		res.Group, res.Slug, res.Name, res.URL = svc.Group, svc.Slug, svc.Name, svc.PublicURL

		t.mu.Lock()
		if t.links == nil {
			t.links, t.history = map[string]*LinkUptime{}, map[string][]bool{}
		}
		h := append(t.history[key], res.Up)
		if len(h) > uptimeKeep {
			h = h[len(h)-uptimeKeep:]
		}
		t.history[key] = h
		up := 0
		for _, ok := range h {
			if ok {
				up++
			}
		}
		res.Checks, res.Uptime = len(h), float64(up)*100/float64(len(h))
		if prev := t.links[key]; prev != nil && !res.Up {
			res.Failures = prev.Failures + 1
		} else if !res.Up {
			res.Failures = 1
		}
		t.links[key] = &res
		t.mu.Unlock()
	}
	t.mu.Lock()
	for key := range t.links {
		if !live[key] {
			delete(t.links, key)
			delete(t.history, key)
		}
	}
	t.mu.Unlock()
}

func probeLink(ctx context.Context, client *http.Client, target string) LinkUptime {
	res := LinkUptime{CheckedAt: time.Now()}
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, target, nil)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	req.Header.Set("User-Agent", "FireWifi-uptime/1")
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		res.Error = shortNetError(err)
		return res
	}
	defer resp.Body.Close()
	res.LatencyMS = int(time.Since(start).Milliseconds())
	res.Status = resp.StatusCode
	// 4xx still means the app answered (auth walls, missing paths); 5xx and
	// Cloudflare's 52x "origin unreachable" mean visitors see an error page.
	res.Up = resp.StatusCode < 500
	if !res.Up {
		res.Error = resp.Status
	}
	if days, ok := certDaysLeft(resp.TLS); ok {
		res.CertDays = &days
	}
	return res
}

func certDaysLeft(cs *tls.ConnectionState) (int, bool) {
	if cs == nil || len(cs.PeerCertificates) == 0 {
		return 0, false
	}
	return int(time.Until(cs.PeerCertificates[0].NotAfter).Hours() / 24), true
}

func shortNetError(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline"):
		return "No answer within 10 s"
	case strings.Contains(msg, "no such host"):
		return "Domain does not resolve"
	case strings.Contains(msg, "certificate"):
		return "Certificate problem"
	}
	return "Could not connect"
}

func (s *Server) linkUptime() []LinkUptime {
	t := &s.uptime
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]LinkUptime, 0, len(t.links))
	for _, l := range t.links {
		out = append(out, *l)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Group+out[i].Slug < out[j].Group+out[j].Slug })
	return out
}

// uptimeAlerts: a link down for two checks in a row, or a certificate close to expiry.
func (s *Server) uptimeAlerts() []alerts.Alert {
	var out []alerts.Alert
	for _, l := range s.linkUptime() {
		name := l.Name
		if name == "" {
			name = l.Slug
		}
		if l.Failures >= 2 {
			out = append(out, alerts.Alert{Key: "link-down:" + l.Group + "/" + l.Slug, Category: alerts.EventLinks, Title: name + " public link is down", Body: fmt.Sprintf("%s: %s", l.URL, l.Error), Priority: "high", Tags: "globe_with_meridians"})
		}
		if l.CertDays != nil && *l.CertDays < certWarnDays {
			out = append(out, alerts.Alert{Key: "link-cert:" + l.Group + "/" + l.Slug, Category: alerts.EventLinks, Title: name + " certificate expires soon", Body: fmt.Sprintf("%s: %d days left.", l.URL, *l.CertDays), Priority: "default", Tags: "lock", NoResolve: true})
		}
	}
	return out
}

func (s *Server) handleUptime(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	jsonReply(w, s.linkUptime())
}
