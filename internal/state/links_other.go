//go:build !linux

package state

import (
	"net"
	"time"
)

// wanDialer on non-Linux dev machines cannot bind to an interface.
func wanDialer(_ string, timeout time.Duration) *net.Dialer {
	return &net.Dialer{Timeout: timeout}
}

// probeInternet reports general reachability so the UI can be developed locally.
func probeInternet(string) bool {
	conn, err := net.DialTimeout("tcp4", "1.1.1.1:443", 3*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
