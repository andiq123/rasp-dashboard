package state

import (
	"net"
	"syscall"
	"time"
)

// wanDialer returns a dialer bound to iface (SO_BINDTODEVICE), so connections
// use the physical uplink even while host traffic goes through the tunnel.
func wanDialer(iface string, timeout time.Duration) *net.Dialer {
	return &net.Dialer{
		Timeout: timeout,
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
}

// probeInternet reports whether the physical uplink reaches the internet.
func probeInternet(iface string) bool {
	d := wanDialer(iface, 3*time.Second)
	for _, addr := range []string{"1.1.1.1:443", "8.8.8.8:443"} {
		if conn, err := d.Dial("tcp4", addr); err == nil {
			conn.Close()
			return true
		}
	}
	return false
}
