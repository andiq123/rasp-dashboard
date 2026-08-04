package deploy

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const maxDeployQueue = 32

// QueueItem is a waiting deploy or data-service creation shown in the live pipeline.
type QueueItem struct {
	ID         string `json:"id"`
	Group      string `json:"group"`
	Slug       string `json:"slug"`
	Name       string `json:"name,omitempty"`
	Title      string `json:"title"`
	Reason     string `json:"reason,omitempty"` // deploy | redeploy | auto | webhook
	EnqueuedAt string `json:"enqueued_at"`
	Position   int    `json:"position"`
	Type       string `json:"type,omitempty"`
	Create     bool   `json:"pending_create,omitempty"`
}

type queuedDeploy struct {
	id         string
	kind       string
	plan       goDeployPlan
	group      string
	slug       string
	name       string
	version    string
	reason     string
	enqueuedAt time.Time
}

func (q queuedDeploy) serviceType() string {
	if strings.TrimSpace(q.kind) == "" {
		return TypeGo
	}
	return q.kind
}

func (q queuedDeploy) scope() string {
	if q.serviceType() == TypeGo {
		return q.plan.scope()
	}
	return serviceKey(q.group, q.slug)
}

func (q queuedDeploy) groupSlug() (string, string) {
	if q.serviceType() == TypeGo {
		return q.plan.Group, q.plan.Slug
	}
	return q.group, q.slug
}

func (q queuedDeploy) displayName() string {
	if q.serviceType() == TypeGo {
		return q.plan.Name
	}
	return q.name
}

func (q queuedDeploy) title() string {
	if q.serviceType() == TypeGo {
		return q.plan.title()
	}
	switch q.serviceType() {
	case TypePostgres:
		return "Create Postgres · " + q.name
	case TypeBucket:
		return "Create Bucket · " + q.name
	case TypeRedis:
		return "Create Redis · " + q.name
	default:
		return "Create service · " + q.name
	}
}

func (q queuedDeploy) pendingCreate() bool {
	// Go creates are written to the registry as queued immediately, so their
	// detail route exists. Infrastructure services are only persisted after
	// provisioning succeeds and must link back to their group while waiting.
	return q.serviceType() != TypeGo
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
			if m.deployQueue[i].scope() == plan.scope() {
				if m.deployQueue[i].serviceType() != TypeGo {
					m.jobMu.Unlock()
					return false, Service{}, fmt.Errorf("service already queued with another type")
				}
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
				kind:       TypeGo,
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

// reserveOrEnqueueCreate joins Postgres, Bucket, and Redis creation to the same
// FIFO pipeline as Go deploys. Validation happens before accepting the item.
func (m *Manager) reserveOrEnqueueCreate(kind, group, name, version string) (bool, Service, queuedDeploy, error) {
	name = strings.TrimSpace(name)
	slug := slugify(name)
	if err := requireSlug(group, "group"); err != nil {
		return false, Service{}, queuedDeploy{}, err
	}
	if name == "" || slug == "" {
		return false, Service{}, queuedDeploy{}, fmt.Errorf("name required")
	}
	switch kind {
	case TypePostgres:
		if m.Postgres == nil {
			return false, Service{}, queuedDeploy{}, fmt.Errorf("postgres engine not configured")
		}
	case TypeBucket:
		if m.MinIO == nil {
			return false, Service{}, queuedDeploy{}, fmt.Errorf("minio engine not configured")
		}
	case TypeRedis:
	default:
		return false, Service{}, queuedDeploy{}, fmt.Errorf("unsupported queued service type %q", kind)
	}

	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err == nil {
		if _, idx := findGroup(reg, group); idx < 0 {
			err = fmt.Errorf("group not found — create a group first")
		} else if _, idx := findService(reg, group, slug); idx >= 0 {
			err = fmt.Errorf("service already exists in group")
		}
	}
	m.mu.Unlock()
	if err != nil {
		return false, Service{}, queuedDeploy{}, err
	}

	next := queuedDeploy{
		id: newQueueID(), kind: kind, group: group, slug: slug, name: name,
		version: strings.TrimSpace(version), reason: "create", enqueuedAt: time.Now().UTC(),
	}
	queued := Service{
		Group: group, Slug: slug, Type: kind, Name: name,
		Status: "queued", Running: false, UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	m.jobMu.Lock()
	if m.jobBusy {
		if strings.TrimSpace(m.jobScope) == group {
			m.jobMu.Unlock()
			return false, Service{}, queuedDeploy{}, fmt.Errorf("group operation in progress — wait for it to finish")
		}
		if strings.TrimSpace(m.jobScope) == next.scope() {
			m.jobMu.Unlock()
			return false, Service{}, queuedDeploy{}, fmt.Errorf("service is already being created")
		}
		for i := range m.deployQueue {
			if m.deployQueue[i].scope() != next.scope() {
				continue
			}
			if m.deployQueue[i].serviceType() != kind {
				m.jobMu.Unlock()
				return false, Service{}, queuedDeploy{}, fmt.Errorf("service already queued with another type")
			}
			m.deployQueue[i].name = name
			m.deployQueue[i].version = next.version
			updated := m.deployQueue[i]
			m.syncQueueLocked()
			m.jobMu.Unlock()
			return false, queued, updated, nil
		}
		if len(m.deployQueue) >= maxDeployQueue {
			m.jobMu.Unlock()
			return false, Service{}, queuedDeploy{}, fmt.Errorf("deploy queue full (%d) — wait for the pipeline", maxDeployQueue)
		}
		m.deployQueue = append(m.deployQueue, next)
		position := len(m.deployQueue)
		m.syncQueueLocked()
		m.jobMu.Unlock()
		m.logf("info", "Queued · %s (#%d) · %s", next.scope(), position, next.serviceType())
		return false, queued, next, nil
	}
	m.jobBusy = true
	m.jobScope = next.scope()
	m.jobStartedAt = time.Now()
	m.jobMu.Unlock()
	m.beginJob(next.title(), next.scope())
	return true, Service{}, next, nil
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
		group, slug := q.groupSlug()
		items = append(items, QueueItem{
			ID:         q.id,
			Group:      group,
			Slug:       slug,
			Name:       q.displayName(),
			Title:      q.title(),
			Reason:     q.reason,
			EnqueuedAt: q.enqueuedAt.Format(time.RFC3339),
			Position:   i + 1,
			Type:       q.serviceType(),
			Create:     q.pendingCreate(),
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
	m.jobScope = strings.TrimSpace(next.scope())
	m.jobStartedAt = time.Now()
	m.syncQueueLocked()
	return next, true
}

func (m *Manager) startQueuedDeploy(next queuedDeploy) {
	m.beginJob(next.title(), next.scope())
	m.logf("info", "Dequeued · %s · %s", next.scope(), next.reason)

	parent := context.Background()
	if m.bgCtx != nil {
		parent = m.bgCtx
	}
	go func() {
		ctx, cancel := context.WithTimeout(parent, 25*time.Minute)
		defer cancel()
		if next.serviceType() == TypeGo {
			_, _ = m.executeGoDeploy(ctx, next.plan)
		} else {
			_, _ = m.executeQueuedCreate(ctx, next)
		}
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
		if q.scope() == serviceKey(group, slug) {
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
		if q.scope() == serviceKey(group, slug) {
			return true
		}
	}
	return false
}
