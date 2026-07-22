package deploy

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	activityMaxLines = 500
	activityMaxSubs  = 32
)

// ActivityLine is one log row shown in the live console.
type ActivityLine struct {
	Seq   int    `json:"seq"`
	At    string `json:"at"`
	Level string `json:"level"` // step | info | cmd | out | ok | warn | err
	Text  string `json:"text"`
}

// ActivitySnapshot is the public activity state for API/SSE.
type ActivitySnapshot struct {
	Seq       int            `json:"seq"`
	Active    bool           `json:"active"`
	Title     string         `json:"title,omitempty"`
	Scope        string         `json:"scope,omitempty"`
	DeploymentID string         `json:"deployment_id,omitempty"`
	StartedAt    string         `json:"started_at,omitempty"`
	EndedAt   string         `json:"ended_at,omitempty"`
	OK        *bool          `json:"ok,omitempty"`
	Progress  *Progress      `json:"progress,omitempty"`
	Lines     []ActivityLine `json:"lines"`
}

// ActivityHub keeps a ring buffer of deploy/ops logs and fans out to SSE subscribers.
type ActivityHub struct {
	mu           sync.Mutex
	seq          int
	active       bool
	title        string
	scope        string
	deploymentID string
	started      string
	ended        string
	ok           *bool
	progress     *Progress
	lines        []ActivityLine
	subs         map[chan ActivitySnapshot]struct{}
	// persist writes a line to durable deploy logs (set by Manager).
	persist func(scope, deployID string, line ActivityLine)
}

func newActivityHub() *ActivityHub {
	return &ActivityHub{
		lines: make([]ActivityLine, 0, 64),
		subs:  make(map[chan ActivitySnapshot]struct{}),
	}
}

func (h *ActivityHub) Begin(title, scope string) {
	h.BeginDeploy(title, scope, "")
}

func (h *ActivityHub) BeginDeploy(title, scope, deploymentID string) {
	if h == nil {
		return
	}
	h.mu.Lock()
	h.active = true
	h.title = strings.TrimSpace(title)
	h.scope = strings.TrimSpace(scope)
	h.deploymentID = strings.TrimSpace(deploymentID)
	h.started = time.Now().UTC().Format(time.RFC3339)
	h.ended = ""
	h.ok = nil
	h.progress = nil
	h.lines = h.lines[:0]
	h.seq++
	line := ActivityLine{
		Seq: h.seq, At: time.Now().Format("15:04:05"), Level: "step",
		Text: "Started · " + h.title,
	}
	h.lines = append(h.lines, line)
	scopeCopy, idCopy := h.scope, h.deploymentID
	persist := h.persist
	h.broadcastLocked()
	h.mu.Unlock()
	if persist != nil && idCopy != "" {
		persist(scopeCopy, idCopy, line)
	}
}

func (h *ActivityHub) Log(level, text string) {
	if h == nil {
		return
	}
	text = strings.TrimRight(text, "\r\n")
	if text == "" {
		return
	}
	// Keep individual lines readable on the Pi UI.
	if len(text) > 2000 {
		text = text[:2000] + "…"
	}
	level = strings.TrimSpace(level)
	if level == "" {
		level = "info"
	}
	h.mu.Lock()
	h.seq++
	line := ActivityLine{
		Seq: h.seq, At: time.Now().Format("15:04:05"), Level: level, Text: text,
	}
	h.lines = append(h.lines, line)
	if len(h.lines) > activityMaxLines {
		h.lines = append([]ActivityLine(nil), h.lines[len(h.lines)-activityMaxLines:]...)
	}
	scopeCopy, idCopy := h.scope, h.deploymentID
	persist := h.persist
	h.broadcastLocked()
	h.mu.Unlock()
	if persist != nil && idCopy != "" {
		persist(scopeCopy, idCopy, line)
	}
}

func (h *ActivityHub) End(ok bool, msg string) {
	if h == nil {
		return
	}
	h.mu.Lock()
	h.active = false
	h.ended = time.Now().UTC().Format(time.RFC3339)
	v := ok
	h.ok = &v
	if h.progress != nil {
		if ok {
			h.finishProgressLocked()
		} else {
			h.failProgressLocked()
		}
	}
	level := "ok"
	if !ok {
		level = "err"
	}
	text := strings.TrimSpace(msg)
	if text == "" {
		if ok {
			text = "Done"
		} else {
			text = "Failed"
		}
	}
	h.seq++
	line := ActivityLine{
		Seq: h.seq, At: time.Now().Format("15:04:05"), Level: level, Text: text,
	}
	h.lines = append(h.lines, line)
	if len(h.lines) > activityMaxLines {
		h.lines = append([]ActivityLine(nil), h.lines[len(h.lines)-activityMaxLines:]...)
	}
	scopeCopy, idCopy := h.scope, h.deploymentID
	persist := h.persist
	h.broadcastLocked()
	// After clients receive the final snapshot, wipe the in-memory ring so a
	// page refresh / new SSE subscribe does not resurrect a finished job.
	h.lines = h.lines[:0]
	h.progress = nil
	h.title = ""
	h.scope = ""
	h.deploymentID = ""
	h.started = ""
	h.ended = ""
	h.ok = nil
	h.mu.Unlock()
	if persist != nil && idCopy != "" {
		persist(scopeCopy, idCopy, line)
	}
}

// StartProgress installs a weighted step pipeline for the current job.
func (h *ActivityHub) StartProgress(steps []ProgressStep) {
	if h == nil || len(steps) == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	copied := make([]ProgressStep, len(steps))
	for i, s := range steps {
		w := s.Weight
		if w <= 0 {
			w = 1
		}
		st := s.Status
		if st == "" {
			st = "pending"
		}
		copied[i] = ProgressStep{ID: s.ID, Label: s.Label, Status: st, Weight: w}
	}
	h.progress = &Progress{
		Percent: 0,
		Total:   len(copied),
		Index:   0,
		Steps:   copied,
		Detail:  "",
	}
	h.recomputeProgressLocked()
	h.seq++
	h.broadcastLocked()
}

// Advance marks id as the active step (previous active → done).
func (h *ActivityHub) Advance(id string) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.progress == nil {
		return
	}
	found := -1
	for i := range h.progress.Steps {
		if h.progress.Steps[i].ID == id {
			found = i
			break
		}
	}
	if found < 0 {
		return
	}
	for i := range h.progress.Steps {
		st := h.progress.Steps[i].Status
		if i < found {
			if st == "pending" || st == "active" {
				h.progress.Steps[i].Status = "done"
			}
		} else if i == found {
			h.progress.Steps[i].Status = "active"
		}
	}
	h.progress.Detail = ""
	h.recomputeProgressLocked()
	h.seq++
	h.broadcastLocked()
}

// Skip marks a step as skipped without counting it as failure.
func (h *ActivityHub) Skip(id string) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.progress == nil {
		return
	}
	for i := range h.progress.Steps {
		if h.progress.Steps[i].ID == id {
			h.progress.Steps[i].Status = "skipped"
			break
		}
	}
	h.recomputeProgressLocked()
	h.seq++
	h.broadcastLocked()
}

// SetDetail updates the subtitle under the current step (e.g. cache hit).
func (h *ActivityHub) SetDetail(detail string) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.progress == nil {
		return
	}
	h.progress.Detail = strings.TrimSpace(detail)
	h.seq++
	h.broadcastLocked()
}

func (h *ActivityHub) finishProgressLocked() {
	if h.progress == nil {
		return
	}
	for i := range h.progress.Steps {
		st := h.progress.Steps[i].Status
		if st == "pending" || st == "active" {
			h.progress.Steps[i].Status = "done"
		}
	}
	h.progress.Percent = 100
	h.progress.Current = ""
	h.progress.Label = "Complete"
	h.progress.Detail = ""
	h.progress.Remaining = ""
	h.progress.Index = h.progress.Total
	h.recomputeProgressLocked()
	h.progress.Percent = 100
	h.progress.Remaining = ""
	h.progress.Label = "Complete"
}

func (h *ActivityHub) failProgressLocked() {
	if h.progress == nil {
		return
	}
	for i := range h.progress.Steps {
		if h.progress.Steps[i].Status == "active" {
			h.progress.Steps[i].Status = "error"
		}
	}
	h.recomputeProgressLocked()
	if h.progress.Label == "" {
		h.progress.Label = "Failed"
	}
	h.progress.Remaining = ""
}

func (h *ActivityHub) recomputeProgressLocked() {
	p := h.progress
	if p == nil {
		return
	}
	totalW := 0
	doneW := 0
	pending := 0
	activeIdx := -1
	for i, s := range p.Steps {
		totalW += s.Weight
		switch s.Status {
		case "done", "skipped":
			doneW += s.Weight
		case "active":
			activeIdx = i
			// Credit a fraction of the active step so the bar never looks stuck at 0.
			doneW += (s.Weight * 35) / 100
		case "error":
			doneW += (s.Weight * 35) / 100
			activeIdx = i
		default:
			pending++
		}
	}
	pct := 0
	if totalW > 0 {
		pct = (doneW * 100) / totalW
		if pct > 99 && activeIdx >= 0 {
			pct = 99
		}
		if pct > 100 {
			pct = 100
		}
	}
	p.Percent = pct
	p.Total = len(p.Steps)
	if activeIdx >= 0 {
		p.Index = activeIdx + 1
		p.Current = p.Steps[activeIdx].ID
		p.Label = p.Steps[activeIdx].Label
		p.Remaining = formatRemaining(pending)
	} else {
		// All done or not started.
		doneCount := 0
		for _, s := range p.Steps {
			if s.Status == "done" || s.Status == "skipped" {
				doneCount++
			}
		}
		p.Index = doneCount
		if doneCount >= len(p.Steps) && len(p.Steps) > 0 {
			p.Percent = 100
			p.Current = ""
			p.Label = "Complete"
			p.Remaining = ""
		} else if doneCount == 0 {
			p.Index = 0
			p.Current = ""
			p.Label = "Starting…"
			p.Remaining = formatRemaining(len(p.Steps))
		}
	}
}

func (h *ActivityHub) Snapshot() ActivitySnapshot {
	if h == nil {
		return ActivitySnapshot{Lines: []ActivityLine{}}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.snapshotLocked()
}

func (h *ActivityHub) snapshotLocked() ActivitySnapshot {
	lines := make([]ActivityLine, 0, len(h.lines))
	lines = append(lines, h.lines...)
	out := ActivitySnapshot{
		Seq:       h.seq,
		Active:    h.active,
		Title:        h.title,
		Scope:        h.scope,
		DeploymentID: h.deploymentID,
		StartedAt:    h.started,
		EndedAt:   h.ended,
		OK:        h.ok,
		Lines:     lines,
	}
	if h.progress != nil {
		cp := *h.progress
		cp.Steps = append([]ProgressStep(nil), h.progress.Steps...)
		out.Progress = &cp
	}
	return out
}

// Subscribe receives snapshots whenever activity changes. Call cancel to unsubscribe.
func (h *ActivityHub) Subscribe() (<-chan ActivitySnapshot, func()) {
	ch := make(chan ActivitySnapshot, 4)
	if h == nil {
		close(ch)
		return ch, func() {}
	}
	h.mu.Lock()
	if len(h.subs) >= activityMaxSubs {
		h.mu.Unlock()
		close(ch)
		return ch, func() {}
	}
	h.subs[ch] = struct{}{}
	// Initial snapshot so clients catch up immediately.
	snap := h.snapshotLocked()
	h.mu.Unlock()
	select {
	case ch <- snap:
	default:
	}
	cancel := func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
	return ch, cancel
}

func (h *ActivityHub) broadcastLocked() {
	snap := h.snapshotLocked()
	for ch := range h.subs {
		select {
		case ch <- snap:
		default:
			// Drop if subscriber is slow — next event will catch up via Snapshot().
		}
	}
}

func (m *Manager) logf(level, format string, args ...interface{}) {
	if m == nil || m.Activity == nil {
		return
	}
	m.Activity.Log(level, fmt.Sprintf(format, args...))
}

func (m *Manager) beginJob(title, scope string) {
	if m == nil || m.Activity == nil {
		return
	}
	m.Activity.Begin(title, scope)
}

func (m *Manager) beginJobDeploy(title, scope, deployID string) {
	if m == nil || m.Activity == nil {
		return
	}
	if group, slug, ok := parseJobScope(scope); ok && strings.TrimSpace(deployID) != "" {
		m.resetDeployLog(group, slug, deployID)
	}
	m.Activity.BeginDeploy(title, scope, deployID)
}

func (m *Manager) bindActivityPersist() {
	if m == nil || m.Activity == nil {
		return
	}
	m.Activity.persist = func(scope, deployID string, line ActivityLine) {
		group, slug, ok := parseJobScope(scope)
		if !ok {
			return
		}
		m.appendDeployLog(group, slug, deployID, line)
	}
}

func (h *ActivityHub) SetDeploymentID(id string) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.deploymentID = strings.TrimSpace(id)
	h.seq++
	h.broadcastLocked()
}

// AttachDeploymentID sets the job's deploy id and persists any lines already logged.
func (m *Manager) AttachDeploymentID(id string) {
	if m == nil || m.Activity == nil {
		return
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	h := m.Activity
	h.mu.Lock()
	prev := h.deploymentID
	h.deploymentID = id
	scopeCopy := h.scope
	linesCopy := append([]ActivityLine(nil), h.lines...)
	h.seq++
	h.broadcastLocked()
	h.mu.Unlock()
	if id == prev {
		return
	}
	group, slug, ok := parseJobScope(scopeCopy)
	if !ok {
		return
	}
	m.resetDeployLog(group, slug, id)
	for _, line := range linesCopy {
		m.appendDeployLog(group, slug, id, line)
	}
}

func (m *Manager) endJob(ok bool, msg string) {
	if m == nil || m.Activity == nil {
		return
	}
	m.Activity.End(ok, msg)
}
