package deploy

import (
	"testing"
	"time"
)

func TestStatsHubPublish(t *testing.T) {
	h := newStatsHub()
	ch, cancel := h.subscribe()
	defer cancel()

	snap := StatsSnapshot{
		At: "t",
		Groups: map[string]map[string]RuntimeStats{
			"g": {"app": {CPUPercent: 12, MemoryMB: 64}},
		},
	}
	h.publish(snap)
	got := <-ch
	if got.Groups["g"]["app"].MemoryMB != 64 {
		t.Fatalf("got %+v", got)
	}
}

func TestStatsHubUsesActiveIntervalOnlyWithSubscribers(t *testing.T) {
	h := newStatsHub()
	if got := h.interval(); got != statsIdleInterval {
		t.Fatalf("idle interval = %s, want %s", got, statsIdleInterval)
	}
	_, cancel := h.subscribe()
	if got := h.interval(); got != statsActiveInterval {
		t.Fatalf("active interval = %s, want %s", got, statsActiveInterval)
	}
	cancel()
	if got := h.interval(); got != 30*time.Second {
		t.Fatalf("restored idle interval = %s", got)
	}
}
