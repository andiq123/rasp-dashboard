package deploy

import (
	"context"
	"testing"
	"time"
)

func TestJobBusyScopedExactMatch(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	m.jobMu.Lock()
	m.jobBusy = true
	m.jobScope = "g/a"
	m.jobMu.Unlock()

	if !m.jobBusyScoped("g", "a") {
		t.Fatal("expected match for active service")
	}
	if m.jobBusyScoped("g", "b") {
		t.Fatal("sibling must not match via group prefix")
	}

	m.jobMu.Lock()
	m.jobScope = "g"
	m.jobMu.Unlock()
	if !m.jobBusyScoped("g", "a") {
		t.Fatal("group-level job should match services in that group")
	}
}

func TestForceClearJobHandoffFIFO(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	planA := goDeployPlan{Group: "g", Slug: "a", Name: "A", Reuse: true, Request: CreateGoRequest{Repo: "o/a", Name: "A"}}
	planB := goDeployPlan{Group: "g", Slug: "b", Name: "B", Reuse: true, Request: CreateGoRequest{Repo: "o/b", Name: "B"}}

	if _, _, err := m.reserveOrEnqueue(planA, "redeploy"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := m.reserveOrEnqueue(planB, "redeploy"); err != nil {
		t.Fatal(err)
	}

	// Same critical section as forceClearJob — assert FIFO handoff without starting executeGoDeploy.
	m.jobMu.Lock()
	if !m.jobBusy {
		m.jobMu.Unlock()
		t.Fatal("expected busy")
	}
	_ = m.clearJobSlotLocked()
	next, hasNext := m.popNextDeployLocked()
	m.jobMu.Unlock()
	if !hasNext || next.plan.Slug != "b" {
		t.Fatalf("handoff next=%q hasNext=%v", next.plan.Slug, hasNext)
	}
	m.jobMu.Lock()
	ql := len(m.deployQueue)
	busy := m.jobBusy
	scope := m.jobScope
	m.jobMu.Unlock()
	if ql != 0 || !busy || scope != "g/b" {
		t.Fatalf("after handoff queue=%d busy=%v scope=%q", ql, busy, scope)
	}
}

func TestDeployQueueFull(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	first := goDeployPlan{Group: "g", Slug: "active", Name: "A", Reuse: true, Request: CreateGoRequest{Repo: "o/a", Name: "A"}}
	if _, _, err := m.reserveOrEnqueue(first, "redeploy"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < maxDeployQueue; i++ {
		p := goDeployPlan{
			Group: "g", Slug: "s" + string(rune('a'+i%26)) + string(rune('0'+i/26)),
			Name: "S", Reuse: true, Request: CreateGoRequest{Repo: "o/s", Name: "S"},
		}
		// Unique slugs
		p.Slug = "s" + itoa(i)
		if _, _, err := m.reserveOrEnqueue(p, "redeploy"); err != nil {
			t.Fatalf("queue item %d: %v", i, err)
		}
	}
	overflow := goDeployPlan{Group: "g", Slug: "overflow", Name: "O", Reuse: true, Request: CreateGoRequest{Repo: "o/o", Name: "O"}}
	_, _, err := m.reserveOrEnqueue(overflow, "redeploy")
	if err == nil {
		t.Fatal("expected queue full error")
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func TestRefreshStatusPreservesQueued(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	planA := goDeployPlan{Group: "g", Slug: "a", Name: "A", Reuse: true, Request: CreateGoRequest{Repo: "o/a", Name: "A"}}
	planB := goDeployPlan{Group: "g", Slug: "b", Name: "B", Reuse: true, Request: CreateGoRequest{Repo: "o/b", Name: "B"}}
	if _, _, err := m.reserveOrEnqueue(planA, "redeploy"); err != nil {
		t.Fatal(err)
	}
	queued, err := func() (Service, error) {
		_, svc, err := m.reserveOrEnqueue(planB, "redeploy")
		return svc, err
	}()
	if err != nil {
		t.Fatal(err)
	}
	if queued.Status != "queued" {
		t.Fatalf("status=%q", queued.Status)
	}

	// Simulate list refresh while old container would look "running".
	out := m.refreshStatus(context.Background(), Service{
		Group: "g", Slug: "b", Type: TypeGo, Status: "queued", Port: 8080,
	})
	if out.Status != "queued" {
		t.Fatalf("refresh clobbered queued → %q", out.Status)
	}
}

func TestWaitJobIdleForScopeIgnoresSibling(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	m.jobMu.Lock()
	m.jobBusy = true
	m.jobScope = "g/a"
	m.jobMu.Unlock()

	if err := m.waitJobIdleForScope("g", "b", 200*time.Millisecond); err != nil {
		t.Fatalf("sibling wait should return immediately: %v", err)
	}
}
