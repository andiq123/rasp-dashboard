package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"firewifi/dashboard/internal/runner"
	"firewifi/dashboard/internal/state"
)

type vpnStateReader struct{ value State }

func (r *vpnStateReader) Read() (State, error) { return r.value, nil }

type vpnController struct {
	mu      sync.Mutex
	calls   int
	block   chan struct{}
	failure error
}

func (c *vpnController) Start(context.Context) error   { return nil }
func (c *vpnController) Stop(context.Context) error    { return nil }
func (c *vpnController) Restart(context.Context) error { return nil }
func (c *vpnController) RepairVPN(ctx context.Context) error {
	return c.RepairVPNWithProgress(ctx, nil)
}
func (c *vpnController) RepairVPNWithProgress(ctx context.Context, report runner.VPNRepairProgress) error {
	c.mu.Lock()
	c.calls++
	c.mu.Unlock()
	if report != nil {
		report("fetching", "Downloading the current Romanian relay list")
		report("restarting", "Restarting WireGuard with the selected relay")
	}
	if c.block != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-c.block:
		}
	}
	return c.failure
}

func TestVPNRepairSingleFlightAndProgress(t *testing.T) {
	controller := &vpnController{block: make(chan struct{})}
	c := newVPNRepairCoordinator(&vpnStateReader{}, controller)
	c.ctx = context.Background()
	first, started := c.trigger(false)
	if !started || !first.Active || first.Automatic {
		t.Fatalf("first trigger = %+v, %v", first, started)
	}
	if _, duplicate := c.trigger(false); duplicate {
		t.Fatal("duplicate repair must not start")
	}
	close(controller.block)
	waitVPNRepair(t, c, func(s *state.VPNRepair) bool { return s != nil && !s.Active && s.Phase == "verified" })
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.calls != 1 {
		t.Fatalf("calls = %d", controller.calls)
	}
}

func TestManualVPNRepairReturnsImmediatelyAndContinuesInBackground(t *testing.T) {
	controller := &vpnController{block: make(chan struct{})}
	srv := New(&vpnStateReader{}, nil, controller, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/hotspot/repair-vpn", nil)
	res := httptest.NewRecorder()
	srv.handleHotspot(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", res.Code, res.Body.String())
	}
	status := srv.vpnRepair.snapshot()
	if status == nil || !status.Active {
		t.Fatalf("repair did not continue in background: %+v", status)
	}
	close(controller.block)
	waitVPNRepair(t, srv.vpnRepair, func(s *state.VPNRepair) bool {
		return s != nil && !s.Active && s.Phase == "verified"
	})
}

func TestVPNAutoRepairStartsAfterStableFailure(t *testing.T) {
	reader := &vpnStateReader{value: State{
		Mode: state.ModeMullvad, HotspotRunning: true,
		VPNHealth: state.VPNHealth{CountryAllowed: true, InterfaceUp: true},
	}}
	controller := &vpnController{}
	c := newVPNRepairCoordinator(reader, controller)
	c.ctx = context.Background()
	c.unhealthySince = time.Now().Add(-vpnAutoRepairDelay - time.Second)
	c.observe()
	waitVPNRepair(t, c, func(s *state.VPNRepair) bool {
		return s != nil && !s.Active && s.Automatic && s.Phase == "verified"
	})
}

func TestVPNRepairFailureHasCooldown(t *testing.T) {
	controller := &vpnController{failure: errors.New("safe verification failed")}
	c := newVPNRepairCoordinator(&vpnStateReader{}, controller)
	c.ctx = context.Background()
	_, _ = c.trigger(true)
	status := waitVPNRepair(t, c, func(s *state.VPNRepair) bool { return s != nil && s.Phase == "failed" })
	if status.NextRetryAt == "" || status.Error == "" {
		t.Fatalf("missing retry/error state: %+v", status)
	}
	if _, started := c.trigger(true); started {
		t.Fatal("automatic repair must honor cooldown")
	}
}

func waitVPNRepair(t *testing.T, c *vpnRepairCoordinator, done func(*state.VPNRepair) bool) *state.VPNRepair {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		status := c.snapshot()
		if done(status) {
			return status
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("repair did not reach expected state: %+v", c.snapshot())
	return nil
}
