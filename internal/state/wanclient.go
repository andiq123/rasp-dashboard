package state

import (
	"context"
	"net"
	"net/http"
	"time"
)

// WANHTTPClient returns an HTTP client whose connections and DNS lookups go out
// the physical uplink, never the tunnel: notifications must still leave while
// the VPN is being repaired or the route is switching.
func WANHTTPClient(baseDir string, timeout time.Duration) *http.Client {
	cfg, _ := LoadConfig(baseDir)
	iface := cfg.WANInterface
	if iface == "" {
		iface = defaultWANInterface
	}
	dialer := wanDialer(iface, 5*time.Second)
	dialer.Resolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			// Public resolvers over the uplink, so lookups do not depend on the tunnel either.
			var lastErr error
			for _, server := range []string{"1.1.1.1:53", "8.8.8.8:53"} {
				conn, err := wanDialer(iface, 2*time.Second).DialContext(ctx, network, server)
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			return nil, lastErr
		},
	}
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
				return dialer.DialContext(ctx, "tcp4", addr)
			},
			TLSHandshakeTimeout: 5 * time.Second,
			IdleConnTimeout:     30 * time.Second,
		},
	}
}
