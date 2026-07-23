package deploy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

func TestPublicOpenURL(t *testing.T) {
	cases := []struct {
		base, path, want string
	}{
		{"", "/x", ""},
		{"https://a.trycloudflare.com", "", "https://a.trycloudflare.com/"},
		{"https://a.trycloudflare.com/", "/", "https://a.trycloudflare.com/"},
		{"https://a.trycloudflare.com", "/api/health", "https://a.trycloudflare.com/api/health"},
		{"https://a.trycloudflare.com/", "api", "https://a.trycloudflare.com/api"},
	}
	for _, tc := range cases {
		if got := publicOpenURL(tc.base, tc.path); got != tc.want {
			t.Fatalf("publicOpenURL(%q,%q)=%q want %q", tc.base, tc.path, got, tc.want)
		}
	}
}

func TestProbeOriginHTTPPrefersRoot(t *testing.T) {
	var hits []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.URL.Path)
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html>ok</html>"))
		default:
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		}
	}))
	defer srv.Close()
	p := probeOriginHTTP(mustLocalPort(t, srv.URL))
	if p.Path != "/" || !p.RootOK {
		t.Fatalf("probe=%+v", p)
	}
	if len(hits) != 1 || hits[0] != "/" {
		t.Fatalf("expected early-exit after /, hits=%v", hits)
	}
}

func TestProbeOriginHTTPFirstNonRoot(t *testing.T) {
	var hits []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.URL.Path)
		switch r.URL.Path {
		case "/":
			w.WriteHeader(http.StatusNotFound)
		case "/health":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()
	p := probeOriginHTTP(mustLocalPort(t, srv.URL))
	if p.Path != "/health" || !p.APIOnly || p.RootStatus != 404 {
		t.Fatalf("probe=%+v", p)
	}
	if len(hits) != 2 || hits[0] != "/" || hits[1] != "/health" {
		t.Fatalf("hits=%v", hits)
	}
}

func mustLocalPort(t *testing.T, rawURL string) int {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	n, err := strconv.Atoi(u.Port())
	if err != nil || n <= 0 {
		t.Fatalf("port from %q: %v", rawURL, err)
	}
	return n
}
