package state

import "testing"

func TestCountStations(t *testing.T) {
	out := []byte("Station aa:bb:cc:dd:ee:ff (on uap0)\n\tinactive time:\t10 ms\nStation 11:22:33:44:55:66 (on uap0)\n\tsignal:\t-50 dBm\n")
	if got := countStations(out); got != 2 {
		t.Fatalf("countStations = %d, want 2", got)
	}
	if got := countStations(nil); got != 0 {
		t.Fatalf("countStations(nil) = %d, want 0", got)
	}
}
