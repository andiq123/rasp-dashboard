package deploy

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func serviceKey(group, slug string) string {
	return strings.TrimSpace(group) + "/" + strings.TrimSpace(slug)
}

func (m *Manager) markDeleting(group, slug string) {
	if m == nil {
		return
	}
	m.deletedMu.Lock()
	defer m.deletedMu.Unlock()
	if m.deleting == nil {
		m.deleting = map[string]struct{}{}
	}
	m.deleting[serviceKey(group, slug)] = struct{}{}
}

func (m *Manager) clearDeleting(group, slug string) {
	if m == nil {
		return
	}
	m.deletedMu.Lock()
	defer m.deletedMu.Unlock()
	if m.deleting == nil {
		return
	}
	delete(m.deleting, serviceKey(group, slug))
}

func (m *Manager) isDeleting(group, slug string) bool {
	if m == nil {
		return false
	}
	m.deletedMu.Lock()
	defer m.deletedMu.Unlock()
	_, ok := m.deleting[serviceKey(group, slug)]
	return ok
}

func (m *Manager) registerJobCancel(cancel context.CancelFunc) {
	if m == nil || cancel == nil {
		return
	}
	m.jobMu.Lock()
	defer m.jobMu.Unlock()
	m.jobCancel = cancel
}

func (m *Manager) clearJobCancel(cancel context.CancelFunc) {
	if m == nil {
		return
	}
	m.jobMu.Lock()
	defer m.jobMu.Unlock()
	// Only clear if this is still our registered cancel (avoid clobbering a newer job).
	if cancel != nil && m.jobCancel != nil {
		// identity via pointer string — cancel funcs from WithTimeout are stable for the job lifetime
		if fmt.Sprintf("%p", m.jobCancel) == fmt.Sprintf("%p", cancel) {
			m.jobCancel = nil
		}
	}
}

// cancelJobForScope cancels the active job if it belongs to group/slug.
// Also stops docker build/runtime containers so the cancel is not stuck on a long compile.
func (m *Manager) cancelJobForScope(ctx context.Context, group, slug string) bool {
	if m == nil {
		return false
	}
	m.jobMu.Lock()
	busy := m.jobBusy
	scope := strings.TrimSpace(m.jobScope)
	cancel := m.jobCancel
	m.jobMu.Unlock()
	if !busy {
		return false
	}
	want := serviceKey(group, slug)
	if scope != want && scope != strings.TrimSpace(group) {
		return false
	}
	if cancel != nil {
		cancel()
	}
	// Kill build/runtime containers immediately — CommandContext alone can leave docker run alive.
	stopCtx, stopCancel := context.WithTimeout(ctx, 45*time.Second)
	defer stopCancel()
	m.removeServiceContainers(stopCtx, group, slug)
	return true
}

func (m *Manager) waitJobIdle(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		m.jobMu.Lock()
		busy := m.jobBusy
		m.jobMu.Unlock()
		if !busy {
			return nil
		}
		time.Sleep(80 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for active build to stop")
}

// waitJobIdleForScope returns when this service (or group-level job) no longer holds the slot.
// Sibling jobs do not block — avoids stealing another deploy after queue handoff.
func (m *Manager) waitJobIdleForScope(group, slug string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !m.jobBusyScoped(group, slug) {
			return nil
		}
		time.Sleep(80 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for %s to stop", serviceKey(group, slug))
}

// forceClearJob releases a stuck job slot after cancel (idempotent with releaseJob).
func (m *Manager) forceClearJob(msg string) {
	if m == nil {
		return
	}
	m.jobMu.Lock()
	if !m.jobBusy {
		m.jobMu.Unlock()
		return
	}
	cancel := m.clearJobSlotLocked()
	next, hasNext := m.popNextDeployLocked()
	m.jobMu.Unlock()
	if cancel != nil {
		cancel()
	}
	m.endJob(false, msg)
	if hasNext {
		m.startQueuedDeploy(next)
	}
}

// stopBuildForDelete cancels an in-flight deploy for this service and waits for its slot only.
func (m *Manager) stopBuildForDelete(ctx context.Context, group, slug string) {
	if !m.jobBusyScoped(group, slug) {
		// Still sweep containers in case a prior build left orphans.
		stopCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		m.removeServiceContainers(stopCtx, group, slug)
		return
	}
	_ = m.cancelJobForScope(ctx, group, slug)
	if err := m.waitJobIdleForScope(group, slug, 90*time.Second); err != nil {
		// Only steal the slot if it is still ours — never force-clear a sibling deploy.
		if m.jobBusyScoped(group, slug) {
			m.forceClearJob("Build force-stopped for delete")
		}
	}
}
