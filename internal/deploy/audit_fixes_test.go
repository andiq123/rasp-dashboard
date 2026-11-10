package deploy

import (
	"context"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
)

// A finished job must not clear the cancel func registered by the next job.
func TestClearJobCancelKeepsNewerRegistration(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	_, oldCancel := context.WithCancel(context.Background())
	defer oldCancel()
	_, newCancel := context.WithCancel(context.Background())
	defer newCancel()

	oldToken := m.registerJobCancel(oldCancel)
	newToken := m.registerJobCancel(newCancel)

	m.clearJobCancel(oldToken)
	m.jobMu.Lock()
	kept := m.jobCancel != nil
	m.jobMu.Unlock()
	if !kept {
		t.Fatal("stale token cleared the active job's cancel func")
	}

	m.clearJobCancel(newToken)
	m.jobMu.Lock()
	cleared := m.jobCancel == nil
	m.jobMu.Unlock()
	if !cleared {
		t.Fatal("owner token must clear its own cancel func")
	}
}

// Subscribers beyond the hub limit get a closed channel; that must degrade
// quietly instead of panicking with "send on closed channel".
func TestSubscribeStatsBeyondLimitDoesNotPanic(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	for i := 0; i < statsMaxSubs; i++ {
		ch, cancel := m.SubscribeStats()
		defer cancel()
		select {
		case _, ok := <-ch:
			if !ok {
				t.Fatalf("subscriber %d: channel closed below the limit", i)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("subscriber %d: no bootstrap snapshot", i)
		}
	}
	ch, cancel := m.SubscribeStats()
	defer cancel()
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("subscriber over the limit should get a closed channel")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("over-limit channel should be closed")
	}
}

func TestReadContainerStatsDeadPID(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	// No such process: a stale cached PID must not be reported as a 0% / 0 MB sample.
	if st, ok := m.readContainerStatsPID("fw-g-gone", 0x7ffffff0); ok {
		t.Fatalf("dead PID produced stats: %+v", st)
	}
}

// A line longer than the scanner buffer must not stall the command.
func TestRunCmdLoggedSurvivesOverlongLine(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		// ~700 KB without a newline (scanner limit is 512 KB), then more output.
		_, err := m.runCmdLogged(ctx, "", "sh", "-c",
			`head -c 700000 /dev/zero | tr '\0' 'a'; echo; i=0; while [ $i -lt 2000 ]; do echo "line $i padding padding padding padding padding padding"; i=$((i+1)); done`)
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("command failed: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("runCmdLogged hung after an over-long output line")
	}
}

// The terminal snapshot of a job must reach a subscriber whose buffer is full.
func TestActivityFinalSnapshotReachesSlowSubscriber(t *testing.T) {
	h := newActivityHub()
	ch, cancel := h.Subscribe()
	defer cancel()

	h.Begin("Deploy · app", "g/app")
	for i := 0; i < 50; i++ { // far more events than the subscriber buffer holds
		h.Log("out", "building…")
	}
	h.End(true, "Live")

	var last ActivitySnapshot
	n := 0
drain:
	for {
		select {
		case snap := <-ch:
			last = snap
			n++
		default:
			break drain
		}
	}
	if n == 0 {
		t.Fatal("no snapshots queued")
	}
	if last.Active || last.OK == nil || !*last.OK {
		t.Fatalf("slow subscriber never saw the job end: active=%v ok=%v", last.Active, last.OK)
	}
}

// A deploy that was just dequeued owns the job slot before its registry status
// flips from "queued" to "building". A status refresh in that window must not
// report it failed, and the interrupted-deploy cleanup must not tear it down.
func TestRefreshStatusKeepsDequeuedDeployPending(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	m.mu.Lock()
	err := m.saveRegistry(registry{
		Groups:   []Group{{Slug: "g", Name: "G"}},
		Services: []Service{{Group: "g", Slug: "b", Type: TypeGo, Name: "B", Status: "building", DeployID: "dpl_prev"}},
	})
	m.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	// Slot handed to g/b (popNextDeployLocked), queue already empty.
	m.jobMu.Lock()
	m.jobBusy = true
	m.jobScope = "g/b"
	m.jobStartedAt = time.Now()
	m.jobMu.Unlock()

	out := m.refreshStatus(context.Background(), Service{
		Group: "g", Slug: "b", Type: TypeGo, Status: "queued", Port: 8080,
	})
	if out.Status != "queued" {
		t.Fatalf("dequeued deploy reported as %q (%s)", out.Status, out.LastError)
	}

	// A stale snapshot may still schedule the cleanup; it must re-check ownership.
	m.persistInterruptedAsync(Service{Group: "g", Slug: "b", Type: TypeGo, Status: "failed"})
	time.Sleep(300 * time.Millisecond)
	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if svc, idx := findService(reg, "g", "b"); idx < 0 || svc.Status != "building" {
		t.Fatalf("active deploy was marked %q by interrupted-deploy cleanup", svc.Status)
	}
}

func TestValidateBranch(t *testing.T) {
	for _, ok := range []string{"main", "feature/login-v2", "release-1.2", "user/fix_#12"} {
		if err := validateBranch(ok); err != nil {
			t.Errorf("validateBranch(%q) = %v, want nil", ok, err)
		}
	}
	for _, bad := range []string{"", "--upload-pack=touch /tmp/x", "-f", "a b", "a..b", "x\ny", "ref:spec", strings.Repeat("a", 300)} {
		if err := validateBranch(bad); err == nil {
			t.Errorf("validateBranch(%q) accepted", bad)
		}
	}
}

func TestDockerActionIDRejectsFlags(t *testing.T) {
	for _, ok := range []string{"fw-g-app", "3f2a9c1b7d10", "redis:7.4-alpine", "sha256:abcd", "registry.local:5000/app@sha256:ab"} {
		if id, err := dockerActionID(" " + ok + " "); err != nil || id != ok {
			t.Errorf("dockerActionID(%q) = %q, %v", ok, id, err)
		}
	}
	for _, bad := range []string{"", "  ", "-f", "--all", "a b", "x\n-f"} {
		if _, err := dockerActionID(bad); err == nil {
			t.Errorf("dockerActionID(%q) accepted", bad)
		}
	}

	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()
	if _, err := m.DockerDo(context.Background(), DockerAction{Action: "rm-container", ID: "--force"}); err == nil || !strings.Contains(err.Error(), "invalid id") {
		t.Fatalf("flag-like id must be rejected before docker runs, got %v", err)
	}
}

func TestCloudflaredPIDAliveIgnoresForeignProcess(t *testing.T) {
	if cloudflaredPIDAlive(0) || cloudflaredPIDAlive(0x7ffffff0) {
		t.Fatal("dead PIDs must not be alive")
	}
	if runtime.GOOS != "linux" {
		t.Skip("cmdline check needs procfs")
	}
	// This test binary is alive but is not cloudflared: a recycled PID.
	if cloudflaredPIDAlive(os.Getpid()) {
		t.Fatal("unrelated live process was accepted as the tunnel")
	}
}
