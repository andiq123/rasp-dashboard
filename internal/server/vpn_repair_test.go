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
	srv := New(&vpnStateReader{value: State{Mode: state.ModeMullvad, HotspotRunning: true}}, nil, controller, nil, nil, nil, nil)
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

func TestVPNAutoRepairPendingClearsWhenRouteIsHealthy(t *testing.T) {
	c := newVPNRepairCoordinator(&vpnStateReader{value: State{Mode: state.ModeResidential}}, &vpnController{})
	c.status = state.VPNRepair{Automatic: true, Phase: "scheduled"}
	c.observe()
	if status := c.snapshot(); status != nil {
		t.Fatalf("stale repair remained after route changed: %+v", status)
	}
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
	if status.FailedPhase != "restarting" {
		t.Fatalf("failure lost its actual stage: %+v", status)
	}
	if _, started := c.trigger(true); started {
		t.Fatal("automatic repair must honor cooldown")
	}
	if retry, started := c.trigger(false); !started || !retry.Active || retry.Automatic || retry.Error != "" || retry.NextRetryAt != "" || retry.FailedPhase != "" {
		t.Fatalf("manual retry must bypass cooldown and reset the attempt: %+v, started=%t", retry, started)
	}
	waitVPNRepair(t, c, func(s *state.VPNRepair) bool { return s != nil && s.Phase == "failed" && s.Attempt == 2 })
}

func TestVPNRepairReconcilesCurrentHealth(t *testing.T) {
	healthy := State{Mode: state.ModeMullvad, HotspotRunning: true, VPNHealth: state.VPNHealth{
		CountryAllowed: true, InterfaceUp: true, HandshakeHealthy: true, EgressOK: true,
	}}
	c := newVPNRepairCoordinator(&vpnStateReader{value: healthy}, &vpnController{})
	c.status = state.VPNRepair{Phase: "failed", FailedPhase: "fetching", Error: "download failed", NextRetryAt: time.Now().Add(-time.Second).Format(time.RFC3339)}
	s := c.snapshotFor(healthy)
	if s == nil || s.Phase != "recovered" || s.Error != "" || s.NextRetryAt != "" || s.FailedPhase != "" {
		t.Fatalf("healthy connection retained a stale failure: %+v", s)
	}
	healthy.VPNHealth.EgressOK = false
	if s := c.snapshotFor(healthy); s != nil {
		t.Fatalf("unhealthy connection retained stale success: %+v", s)
	}
	for _, st := range []State{{Mode: state.ModeResidential, HotspotRunning: true}, {Mode: state.ModeMullvad}} {
		c.status = state.VPNRepair{Phase: "failed", Error: "old error"}
		if s := c.snapshotFor(st); s != nil {
			t.Fatalf("inactive VPN route retained recovery state: %+v", s)
		}
	}
}

func TestManualVPNRepairRejectsInactiveRoute(t *testing.T) {
	for _, st := range []State{{Mode: state.ModeResidential, HotspotRunning: true}, {Mode: state.ModeMullvad}} {
		controller := &vpnController{}
		srv := New(&vpnStateReader{value: st}, nil, controller, nil, nil, nil, nil)
		res := httptest.NewRecorder()
		srv.handleHotspot(res, httptest.NewRequest(http.MethodPost, "/api/hotspot/repair-vpn", nil))
		if res.Code != http.StatusConflict {
			t.Fatalf("inactive route status = %d; body = %s", res.Code, res.Body.String())
		}
		controller.mu.Lock()
		calls := controller.calls
		controller.mu.Unlock()
		if calls != 0 {
			t.Fatal("inactive route started a repair")
		}
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
