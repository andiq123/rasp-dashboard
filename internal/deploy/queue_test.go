package deploy

import "testing"

func TestReserveOrEnqueueCoalesce(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	planA := goDeployPlan{Group: "g", Slug: "a", Name: "A", Reuse: true, Request: CreateGoRequest{Repo: "o/a", Name: "A"}}
	planB := goDeployPlan{Group: "g", Slug: "b", Name: "B", Reuse: true, Request: CreateGoRequest{Repo: "o/b", Name: "B"}}

	started, _, err := m.reserveOrEnqueue(planA, "redeploy")
	if err != nil || !started {
		t.Fatalf("first reserve: started=%v err=%v", started, err)
	}

	_, queued, err := m.reserveOrEnqueue(planB, "redeploy")
	if err != nil || queued.Status != "queued" {
		t.Fatalf("second should queue: status=%q err=%v", queued.Status, err)
	}

	_, again, err := m.reserveOrEnqueue(planB, "webhook")
	if err != nil {
		t.Fatal(err)
	}
	if again.Status != "queued" {
		t.Fatalf("coalesce status=%q", again.Status)
	}

	m.jobMu.Lock()
	n := len(m.deployQueue)
	m.jobMu.Unlock()
	if n != 1 {
		t.Fatalf("queue len=%d want 1 (coalesced)", n)
	}

	// Simulate release handoff without running executeGoDeploy.
	m.jobMu.Lock()
	m.jobBusy = false
	next, ok := m.popNextDeployLocked()
	m.jobMu.Unlock()
	if !ok || next.plan.Slug != "b" {
		t.Fatalf("handoff next=%v ok=%v", next.plan.Slug, ok)
	}
	if next.reason != "webhook" {
		t.Fatalf("coalesced reason=%q want webhook", next.reason)
	}
	m.jobMu.Lock()
	ql := len(m.deployQueue)
	busy := m.jobBusy
	m.jobMu.Unlock()
	if ql != 0 || !busy {
		t.Fatalf("after pop queue=%d busy=%v", ql, busy)
	}
}

func TestReleaseJobFIFOOrder(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	planA := goDeployPlan{Group: "g", Slug: "a", Name: "A", Reuse: true, Request: CreateGoRequest{Repo: "o/a", Name: "A"}}
	planB := goDeployPlan{Group: "g", Slug: "b", Name: "B", Reuse: true, Request: CreateGoRequest{Repo: "o/b", Name: "B"}}
	planC := goDeployPlan{Group: "g", Slug: "c", Name: "C", Reuse: true, Request: CreateGoRequest{Repo: "o/c", Name: "C"}}

	if _, _, err := m.reserveOrEnqueue(planA, "redeploy"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := m.reserveOrEnqueue(planB, "redeploy"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := m.reserveOrEnqueue(planC, "redeploy"); err != nil {
		t.Fatal(err)
	}

	m.jobMu.Lock()
	order := []string{m.deployQueue[0].plan.Slug, m.deployQueue[1].plan.Slug}
	m.jobMu.Unlock()
	if order[0] != "b" || order[1] != "c" {
		t.Fatalf("queue order=%v want [b c]", order)
	}
}
