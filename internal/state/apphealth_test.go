package state

import (
	"testing"
	"time"
)

func TestScoreAppsCrashLoop(t *testing.T) {
	seen := map[string][]restartMark{}
	t0 := time.Unix(0, 0)
	c := func(rc int) []inspected {
		x := inspected{Name: "/fw-g-api", RestartCount: rc}
		x.State.Status = "running"
		return []inspected{x}
	}
	if a := scoreApps(c(5), seen, t0); a[0].CrashLoop || a[0].RecentRestarts != 0 {
		t.Fatalf("old restarts from before we watched are not a loop: %+v", a[0])
	}
	scoreApps(c(6), seen, t0.Add(2*time.Minute))
	a := scoreApps(c(8), seen, t0.Add(4*time.Minute))
	if !a[0].CrashLoop || a[0].RecentRestarts != 3 {
		t.Fatalf("3 restarts in 4 minutes is a crash loop: %+v", a[0])
	}
	a = scoreApps(c(8), seen, t0.Add(20*time.Minute))
	if a[0].CrashLoop {
		t.Fatalf("quiet for longer than the window clears the loop: %+v", a[0])
	}
}
