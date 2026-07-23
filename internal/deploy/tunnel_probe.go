package deploy

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Common API / app entrypoints. Prefer HTML at / when present; otherwise first 2xx path.
var originProbePaths = []string{
	"/",
	"/health",
	"/healthz",
	"/ready",
	"/readyz",
	"/ping",
	"/status",
	"/api/health",
	"/api",
}

type originProbe struct {
	Path       string // best path to open ("" if none)
	RootStatus int
	RootOK     bool
	APIOnly    bool // / is not useful (4xx/5xx) but another path is
}

func (m *Manager) writeTunnelOpenPath(group, slug, path string) {
	dir := m.tunnelDir(group, slug)
	_ = os.MkdirAll(dir, 0o755)
	path = strings.TrimSpace(path)
	if path == "" {
		_ = os.Remove(filepath.Join(dir, "open_path"))
		return
	}
	_ = os.WriteFile(filepath.Join(dir, "open_path"), []byte(path+"\n"), 0o644)
}

func (m *Manager) readTunnelOpenPath(group, slug string) string {
	b, err := os.ReadFile(filepath.Join(m.tunnelDir(group, slug), "open_path"))
	if err != nil {
		return ""
	}
	p := strings.TrimSpace(string(b))
	if p == "" || !strings.HasPrefix(p, "/") {
		return ""
	}
	return p
}

func probeOriginHTTP(port int) originProbe {
	out := originProbe{}
	if port <= 0 {
		return out
	}
	client := &http.Client{
		Timeout: 2 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	for _, path := range originProbePaths {
		req, err := http.NewRequest(http.MethodGet, base+path, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", "FireWifi-OriginProbe/1")
		res, err := client.Do(req)
		if err != nil {
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		_ = res.Body.Close()
		ok := res.StatusCode >= 200 && res.StatusCode < 400
		if path == "/" {
			out.RootStatus = res.StatusCode
			out.RootOK = ok
			if ok {
				out.Path = "/"
				return out // good / wins; skip remaining paths
			}
			continue
		}
		if ok {
			out.Path = path
			out.APIOnly = out.RootStatus == 0 || out.RootStatus >= 400
			return out // first non-root 2xx/3xx
		}
	}
	return out
}

func (m *Manager) applyOriginProbe(svc *Service) {
	if svc == nil || svc.Type != TypeGo || svc.Port <= 0 {
		return
	}
	p := probeOriginHTTP(svc.Port)
	svc.PublicPath = p.Path
	m.writeTunnelOpenPath(svc.Group, svc.Slug, p.Path)
	if p.Path == "" {
		return
	}
	if p.APIOnly {
		m.logf("info", "Expose open path for %s/%s: %s (root / → %d)", svc.Group, svc.Slug, p.Path, p.RootStatus)
	} else if p.Path != "/" {
		m.logf("info", "Expose open path for %s/%s: %s", svc.Group, svc.Slug, p.Path)
	}
}

func (m *Manager) restorePublicPath(svc *Service) {
	if svc == nil {
		return
	}
	if p := m.readTunnelOpenPath(svc.Group, svc.Slug); p != "" {
		svc.PublicPath = p
		return
	}
	if svc.PublicURL != "" && svc.Port > 0 {
		m.applyOriginProbe(svc)
	}
}

func publicOpenURL(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	path = strings.TrimSpace(path)
	if base == "" {
		return ""
	}
	if path == "" || path == "/" {
		return base + "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

// verifyPublicURL hits the Cloudflare URL from the Pi so we know the tunnel edge answers.
func verifyPublicURL(ctx context.Context, publicURL, path string) error {
	u := publicOpenURL(publicURL, path)
	if u == "" {
		return fmt.Errorf("empty public url")
	}
	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "FireWifi-TunnelVerify/1")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if res.StatusCode >= 500 {
		return fmt.Errorf("public %s → HTTP %d", u, res.StatusCode)
	}
	return nil
}
