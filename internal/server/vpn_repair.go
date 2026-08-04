package server

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"firewifi/dashboard/internal/runner"
	"firewifi/dashboard/internal/state"
)

const (
	vpnAutoRepairDelay    = 12 * time.Second
	vpnAutoRepairCooldown = 5 * time.Minute
	vpnHealthyGrace       = time.Minute
)

type vpnProgressController interface {
	RepairVPNWithProgress(context.Context, runner.VPNRepairProgress) error
}

type vpnRepairCoordinator struct {
	mu             sync.Mutex
	reader         StateReader
	controller     HotspotController
	ctx            context.Context
	status         state.VPNRepair
	running        bool
	attempt        int
	unhealthySince time.Time
	nextAuto       time.Time
	cancelRun      context.CancelFunc
	cancelReason   string
	subs           map[chan struct{}]struct{}
}

func newVPNRepairCoordinator(reader StateReader, controller HotspotController) *vpnRepairCoordinator {
	return &vpnRepairCoordinator{
		reader: reader, controller: controller, ctx: context.Background(),
		subs: make(map[chan struct{}]struct{}),
	}
}

func (c *vpnRepairCoordinator) start(ctx context.Context) {
	if c == nil || c.reader == nil || c.controller == nil {
		return
	}
	c.mu.Lock()
	c.ctx = ctx
	c.mu.Unlock()
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		c.observe()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.observe()
			}
		}
	}()
}

func (c *vpnRepairCoordinator) observe() {
	var st State
	var err error
	if cached, ok := c.reader.(interface{ ReadShellCached() (State, error) }); ok {
		st, err = cached.ReadShellCached()
	} else {
		st, err = c.reader.Read()
	}
	if err != nil {
		return
	}
	unhealthy := st.Mode == state.ModeMullvad && st.HotspotRunning &&
		!(st.VPNHealth.CountryAllowed && st.VPNHealth.InterfaceUp &&
			st.VPNHealth.HandshakeHealthy && st.VPNHealth.EgressOK)

	now := time.Now()
	c.mu.Lock()
	if !unhealthy {
		c.unhealthySince = time.Time{}
		c.mu.Unlock()
		return
	}
	if c.running {
		c.mu.Unlock()
		return
	}
	if c.unhealthySince.IsZero() {
		c.unhealthySince = now
	}
	due := c.unhealthySince.Add(vpnAutoRepairDelay)
	if c.nextAuto.After(due) {
		due = c.nextAuto
	}
	if now.Before(due) {
		if c.status.Phase == "" || c.status.Phase == "scheduled" {
			c.status = state.VPNRepair{
				Automatic:   true,
				Phase:       "scheduled",
				Message:     "VPN issue detected; automatic repair is waiting for a stable failure",
				Attempt:     c.attempt + 1,
				UpdatedAt:   now.UTC().Format(time.RFC3339),
				NextRetryAt: due.UTC().Format(time.RFC3339),
			}
			c.notifyLocked()
		}
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	c.trigger(true)
}

func (c *vpnRepairCoordinator) trigger(automatic bool) (state.VPNRepair, bool) {
	if c == nil || c.controller == nil {
		return state.VPNRepair{}, false
	}
	now := time.Now()
	c.mu.Lock()
	if c.running {
		status := c.status
		c.mu.Unlock()
		return status, false
	}
	if automatic && now.Before(c.nextAuto) {
		status := c.status
		c.mu.Unlock()
		return status, false
	}
	c.running = true
	c.attempt++
	c.status = state.VPNRepair{
		Active:    true,
		Automatic: automatic,
		Phase:     "preparing",
		Message:   "Preparing Romania-only VPN repair",
		Attempt:   c.attempt,
		StartedAt: now.UTC().Format(time.RFC3339),
		UpdatedAt: now.UTC().Format(time.RFC3339),
	}
	c.notifyLocked()
	ctx, cancel := context.WithCancel(c.ctx)
	c.cancelRun = cancel
	c.cancelReason = ""
	status := c.status
	c.mu.Unlock()

	go c.run(ctx, automatic)
	return status, true
}

func (c *vpnRepairCoordinator) run(ctx context.Context, automatic bool) {
	report := func(phase, message string) {
		now := time.Now().UTC().Format(time.RFC3339)
		c.mu.Lock()
		c.status.Active = true
		c.status.Phase = phase
		c.status.Message = message
		c.status.UpdatedAt = now
		c.notifyLocked()
		c.mu.Unlock()
	}

	var err error
	if progress, ok := c.controller.(vpnProgressController); ok {
		err = progress.RepairVPNWithProgress(ctx, report)
	} else {
		report("repairing", "Refreshing the relay and restarting WireGuard")
		err = c.controller.RepairVPN(ctx)
	}

	now := time.Now()
	c.mu.Lock()
	if c.cancelRun != nil {
		c.cancelRun()
		c.cancelRun = nil
	}
	c.running = false
	c.unhealthySince = time.Time{}
	c.status.Active = false
	c.status.FinishedAt = now.UTC().Format(time.RFC3339)
	c.status.UpdatedAt = c.status.FinishedAt
	if errors.Is(err, context.Canceled) {
		c.status.Phase = "cancelled"
		c.status.Message = c.cancelReason
		if c.status.Message == "" {
			c.status.Message = "VPN recovery stopped"
		}
		c.status.Error = ""
		c.status.NextRetryAt = ""
		c.nextAuto = time.Time{}
	} else if err != nil {
		c.status.Phase = "failed"
		c.status.Message = "Automatic recovery could not verify safe Romanian egress"
		if !automatic {
			c.status.Message = "VPN repair could not verify safe Romanian egress"
		}
		c.status.Error = err.Error()
		c.nextAuto = now.Add(vpnAutoRepairCooldown)
		c.status.NextRetryAt = c.nextAuto.UTC().Format(time.RFC3339)
		log.Printf("VPN repair failed (automatic=%t): %v", automatic, err)
	} else {
		c.status.Phase = "verified"
		c.status.Message = "Romanian Mullvad egress is verified"
		c.status.Error = ""
		c.nextAuto = now.Add(vpnHealthyGrace)
		c.status.NextRetryAt = ""
	}
	c.notifyLocked()
	c.mu.Unlock()
}

func (c *vpnRepairCoordinator) subscribe() (<-chan struct{}, func()) {
	if c == nil {
		ch := make(chan struct{})
		close(ch)
		return ch, func() {}
	}
	ch := make(chan struct{}, 1)
	c.mu.Lock()
	c.subs[ch] = struct{}{}
	c.mu.Unlock()
	return ch, func() {
		c.mu.Lock()
		delete(c.subs, ch)
		c.mu.Unlock()
	}
}

func (c *vpnRepairCoordinator) notifyLocked() {
	for ch := range c.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (c *vpnRepairCoordinator) cancel(reason string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	if c.cancelRun != nil {
		c.cancelReason = reason
		c.cancelRun()
	}
	c.mu.Unlock()
}

func (c *vpnRepairCoordinator) snapshot() *state.VPNRepair {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.status.Phase == "" {
		return nil
	}
	status := c.status
	return &status
}
