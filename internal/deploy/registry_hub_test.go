package deploy

import "testing"

func TestRegistryHubNotify(t *testing.T) {
	h := newRegistryHub()
	ch, cancel := h.Subscribe()
	defer cancel()

	select {
	case ev := <-ch:
		if ev.Seq != 0 {
			t.Fatalf("initial seq = %d, want 0", ev.Seq)
		}
	default:
		t.Fatal("expected initial snapshot")
	}

	h.Notify()
	ev := <-ch
	if ev.Seq != 1 {
		t.Fatalf("after notify seq = %d, want 1", ev.Seq)
	}

	h.Notify()
	ev = <-ch
	if ev.Seq != 2 {
		t.Fatalf("second notify seq = %d, want 2", ev.Seq)
	}
}
