package state

import (
	"os"
	"testing"
)

func TestCountStations(t *testing.T) {
	out := []byte("Station aa:bb:cc:dd:ee:ff (on uap0)\n\tinactive time:\t10 ms\nStation 11:22:33:44:55:66 (on uap0)\n\tsignal:\t-50 dBm\n")
	if got := countStations(out); got != 2 {
		t.Fatalf("countStations = %d, want 2", got)
	}
	if got := countStations(nil); got != 0 {
		t.Fatalf("countStations(nil) = %d, want 0", got)
	}
}

func TestParseStationsAndLeases(t *testing.T) {
	out := []byte("Station AA:BB:CC:DD:EE:FF (on uap0)\n\trx bytes:\t1200\n\ttx bytes:\t3400\n\tsignal:  \t-52 [-52] dBm\n\tconnected time:\t75 seconds\n")
	d := parseStations(out)
	if len(d) != 1 || d[0].MAC != "aa:bb:cc:dd:ee:ff" || d[0].RxBytes != 1200 || d[0].TxBytes != 3400 || d[0].SignalDBM != -52 || d[0].ConnectedSeconds != 75 {
		t.Fatalf("parseStations = %+v", d)
	}
	path := t.TempDir() + "/leases"
	if err := os.WriteFile(path, []byte("1795746870 aa:bb:cc:dd:ee:ff 192.168.5.42 Andis-iPhone 01:aa\n1795746870 11:22:33:44:55:66 192.168.5.43 * *\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	l := readLeases(path)
	if l["aa:bb:cc:dd:ee:ff"].name != "Andis-iPhone" || l["11:22:33:44:55:66"].name != "" || l["11:22:33:44:55:66"].ip != "192.168.5.43" {
		t.Fatalf("readLeases = %+v", l)
	}
}
