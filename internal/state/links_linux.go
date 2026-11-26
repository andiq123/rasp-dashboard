package state

import (
	"net"
	"syscall"
	"time"
)

// probeInternet opens a TCP connection bound to iface (SO_BINDTODEVICE), so the
// answer describes the physical uplink even while host traffic uses the tunnel.
func probeInternet(iface string) bool {
	d := net.Dialer{
		Timeout: 3 * time.Second,
		Control: func(_, _ string, c syscall.RawConn) error {
			var serr error
			if err := c.Control(func(fd uintptr) {
				serr = syscall.SetsockoptString(int(fd), syscall.SOL_SOCKET, syscall.SO_BINDTODEVICE, iface)
			}); err != nil {
				return err
			}
			return serr
		},
	}
	for _, addr := range []string{"1.1.1.1:443", "8.8.8.8:443"} {
		if conn, err := d.Dial("tcp4", addr); err == nil {
			conn.Close()
			return true
		}
	}
	return false
}
