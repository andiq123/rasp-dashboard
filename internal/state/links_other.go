//go:build !linux

package state

import (
	"net"
	"time"
)

// probeInternet on non-Linux dev machines cannot bind to an interface; it reports
// general reachability so the UI can be developed locally.
func probeInternet(string) bool {
	conn, err := net.DialTimeout("tcp4", "1.1.1.1:443", 3*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
