package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

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

func TestMixedServiceQueuePreservesFIFOAndCoalescesCreates(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir, Activity: newActivityHub()}
	if err := os.MkdirAll(filepath.Join(dir, "groups", "g"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := m.saveRegistry(registry{Groups: []Group{{Slug: "g", Name: "G"}}}); err != nil {
		t.Fatal(err)
	}

	active := goDeployPlan{Group: "g", Slug: "api", Name: "API", Request: CreateGoRequest{Name: "API"}}
	started, _, err := m.reserveOrEnqueue(active, "deploy")
	if err != nil || !started {
		t.Fatalf("reserve active: started=%v err=%v", started, err)
	}

	started, queued, _, err := m.reserveOrEnqueueCreate(TypeRedis, "g", "Main_Redis", "")
	if err != nil || started || queued.Status != "queued" || queued.Slug != "main-redis" {
		t.Fatalf("queue redis: started=%v svc=%+v err=%v", started, queued, err)
	}
	// Repeated clicks update the waiting request rather than adding a duplicate.
	if _, _, _, err := m.reserveOrEnqueueCreate(TypeRedis, "g", "Main_Redis", ""); err != nil {
		t.Fatal(err)
	}
	second := goDeployPlan{Group: "g", Slug: "worker", Name: "Worker", Request: CreateGoRequest{Name: "Worker"}}
	if _, _, err := m.reserveOrEnqueue(second, "deploy"); err != nil {
		t.Fatal(err)
	}
	if len(m.deployQueue) != 2 {
		t.Fatalf("queue length=%d want 2", len(m.deployQueue))
	}
	if m.deployQueue[0].serviceType() != TypeRedis || m.deployQueue[1].serviceType() != TypeGo {
		t.Fatalf("wrong FIFO order: %#v", m.deployQueue)
	}

	snap := m.Activity.Snapshot()
	if len(snap.Queue) != 2 || snap.Queue[0].Position != 1 || !snap.Queue[0].Create || snap.Queue[0].Type != TypeRedis {
		t.Fatalf("activity queue=%+v", snap.Queue)
	}
	reg, err := m.loadRegistry()
	if err != nil {
		t.Fatal(err)
	}
	if len(reg.Services) != 0 {
		t.Fatalf("queued create must not leave a phantom registry service: %+v", reg.Services)
	}
}
