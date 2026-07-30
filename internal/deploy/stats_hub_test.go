package deploy

import "testing"

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
