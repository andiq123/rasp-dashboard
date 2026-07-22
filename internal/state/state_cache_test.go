package state

import (
	"sync/atomic"
	"testing"
	"time"
)

type countingReader struct {
	calls int32
}

func (c *countingReader) Read() (State, error) {
	atomic.AddInt32(&c.calls, 1)
	return State{Mode: ModeMullvad}, nil
}

func TestReadShellCachedWithinTTL(t *testing.T) {
	r := &Reader{BaseDir: t.TempDir()}
	// monkey-patch by using ReadShellCached's internal Read - hard without DI.
	// Instead test TTL constant behavior on Reader with short override via direct cache seeding.
	now := time.Now()
	r.cacheMu.Lock()
	r.shell = shellCache{at: now, state: State{Mode: "cached"}, err: nil}
	r.cacheMu.Unlock()

	st, err := r.ReadShellCached()
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode != "cached" {
		t.Fatalf("mode = %q", st.Mode)
	}
}

func TestReadShellCachedExpires(t *testing.T) {
	r := &Reader{BaseDir: t.TempDir()}
	r.cacheMu.Lock()
	r.shell = shellCache{at: time.Now().Add(-3 * time.Second), state: State{Mode: "stale"}, err: nil}
	r.cacheMu.Unlock()

	st, err := r.ReadShellCached()
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode == "stale" {
		t.Fatalf("expected refresh, still stale")
	}
	if st.GeneratedAt == "" {
		t.Fatalf("expected fresh read metadata")
	}
}
