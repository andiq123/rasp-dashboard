package deploy

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const maxDeployQueue = 32

// QueueItem is a waiting Go deploy shown in the live activity console.
type QueueItem struct {
	ID         string `json:"id"`
	Group      string `json:"group"`
	Slug       string `json:"slug"`
	Name       string `json:"name,omitempty"`
	Title      string `json:"title"`
	Reason     string `json:"reason,omitempty"` // deploy | redeploy | auto | webhook
	EnqueuedAt string `json:"enqueued_at"`
	Position   int    `json:"position"`
}

type queuedDeploy struct {
	id         string
	plan       goDeployPlan
	reason     string
	enqueuedAt time.Time
}

func newQueueID() string {
	return fmt.Sprintf("q-%d", time.Now().UnixNano())
}

// reserveOrEnqueue acquires the global job slot or enqueues a Go deploy (FIFO, coalesce per service).
// started=true means the caller must run executeGoDeploy; started=false means the service is queued.
func (m *Manager) reserveOrEnqueue(plan goDeployPlan, reason string) (started bool, queued Service, err error) {
	if m == nil {
		return false, Service{}, fmt.Errorf("manager unavailable")
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "deploy"
	}

	m.jobMu.Lock()
	if m.jobBusy {
		coalesced := false
		for i := range m.deployQueue {
			if m.deployQueue[i].plan.Group == plan.Group && m.deployQueue[i].plan.Slug == plan.Slug {
				m.deployQueue[i].plan = plan
				m.deployQueue[i].reason = reason
				coalesced = true
				break
			}
		}
		if !coalesced {
			if len(m.deployQueue) >= maxDeployQueue {
				m.jobMu.Unlock()
				return false, Service{}, fmt.Errorf("deploy queue full (%d) — wait for builds to finish", maxDeployQueue)
			}
			m.deployQueue = append(m.deployQueue, queuedDeploy{
				id:         newQueueID(),
				plan:       plan,
				reason:     reason,
				enqueuedAt: time.Now().UTC(),
			})
		}
		pos := len(m.deployQueue)
		m.syncQueueLocked()
		m.jobMu.Unlock()

		svc := m.markServiceQueued(plan)
		if coalesced {
			m.logf("info", "Queue updated · %s (already waiting)", plan.scope())
		} else {
			m.logf("info", "Queued · %s (#%d) — one deploy at a time", plan.scope(), pos)
		}
		return false, svc, nil
	}

	m.jobBusy = true
	m.jobScope = strings.TrimSpace(plan.scope())
	m.jobStartedAt = time.Now()
	m.jobMu.Unlock()

	m.beginJob(plan.title(), plan.scope())
	return true, Service{}, nil
}

func (m *Manager) markServiceQueued(plan goDeployPlan) Service {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339)
	svc := Service{
		Group: plan.Group, Slug: plan.Slug, Type: TypeGo, Name: plan.Name,
		Repo: plan.Request.Repo, Branch: plan.Request.Branch,
		Status: "queued", UpdatedAt: now,
	}
	reg, err := m.loadRegistry()
	if err != nil {
		return svc
	}
	if prev, idx := findService(reg, plan.Group, plan.Slug); idx >= 0 {
		prev.Status = "queued"
		prev.LastError = ""
		prev.UpdatedAt = now
		reg.Services[idx] = prev
		_ = m.saveRegistry(reg)
		_ = m.writeMeta(prev)
		return prev
	}
	return svc
}

func (m *Manager) syncQueueLocked() {
	items := make([]QueueItem, 0, len(m.deployQueue))
	for i, q := range m.deployQueue {
		items = append(items, QueueItem{
			ID:         q.id,
			Group:      q.plan.Group,
			Slug:       q.plan.Slug,
			Name:       q.plan.Name,
			Title:      q.plan.title(),
			Reason:     q.reason,
			EnqueuedAt: q.enqueuedAt.Format(time.RFC3339),
			Position:   i + 1,
		})
	}
	if m.Activity != nil {
		m.Activity.SetQueue(items)
	}
}

// popNextDeployLocked takes the head of the queue and marks the job busy.
// Caller must hold jobMu and jobBusy must be false.
func (m *Manager) popNextDeployLocked() (queuedDeploy, bool) {
	if len(m.deployQueue) == 0 {
		m.syncQueueLocked()
		return queuedDeploy{}, false
	}
	next := m.deployQueue[0]
	m.deployQueue = m.deployQueue[1:]
	m.jobBusy = true
	m.jobScope = strings.TrimSpace(next.plan.scope())
	m.jobStartedAt = time.Now()
	m.syncQueueLocked()
	return next, true
}

func (m *Manager) startQueuedDeploy(next queuedDeploy) {
	m.beginJob(next.plan.title(), next.plan.scope())
	m.logf("info", "Dequeued · %s · %s", next.plan.scope(), next.reason)

	parent := context.Background()
	if m.bgCtx != nil {
		parent = m.bgCtx
	}
	go func() {
		ctx, cancel := context.WithTimeout(parent, 25*time.Minute)
		defer cancel()
		_, _ = m.executeGoDeploy(ctx, next.plan)
	}()
}

// kickDeployQueue starts the next queued Go deploy if the job slot is free.
func (m *Manager) kickDeployQueue() {
	if m == nil {
		return
	}
	m.jobMu.Lock()
	if m.jobBusy {
		m.jobMu.Unlock()
		return
	}
	next, ok := m.popNextDeployLocked()
	m.jobMu.Unlock()
	if ok {
		m.startQueuedDeploy(next)
	}
}

// dropQueuedDeploy removes a waiting deploy for a deleted service (jobMu not held).
func (m *Manager) dropQueuedDeploy(group, slug string) {
	if m == nil {
		return
	}
	m.jobMu.Lock()
	out := m.deployQueue[:0]
	changed := false
	for _, q := range m.deployQueue {
		if q.plan.Group == group && q.plan.Slug == slug {
			changed = true
			continue
		}
		out = append(out, q)
	}
	if changed {
		m.deployQueue = out
		m.syncQueueLocked()
	}
	m.jobMu.Unlock()
}

// isDeployQueued reports whether group/slug is waiting in the in-memory deploy queue.
func (m *Manager) isDeployQueued(group, slug string) bool {
	if m == nil {
		return false
	}
	m.jobMu.Lock()
	defer m.jobMu.Unlock()
	for _, q := range m.deployQueue {
		if q.plan.Group == group && q.plan.Slug == slug {
			return true
		}
	}
	return false
}
