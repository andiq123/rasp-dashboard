package deploy

import "fmt"

// ProgressStep is one stage in a job pipeline (shown in the Activity progress UI).
type ProgressStep struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"` // pending | active | done | skipped | error
	Weight int    `json:"weight"`
}

// Progress is live 0–100% job progress with a step timeline.
type Progress struct {
	Percent   int            `json:"percent"`
	Current   string         `json:"current,omitempty"`
	Label     string         `json:"label,omitempty"`
	Detail    string         `json:"detail,omitempty"`
	Remaining string         `json:"remaining,omitempty"`
	Index     int            `json:"index"` // 1-based active/done index
	Total     int            `json:"total"`
	Steps     []ProgressStep `json:"steps"`
}

// DeployGoSteps is the standard Go deploy / redeploy pipeline.
func DeployGoSteps() []ProgressStep {
	return []ProgressStep{
		{ID: "prepare", Label: "Prepare workspace", Weight: 4, Status: "pending"},
		{ID: "clone", Label: "Fetch source", Weight: 14, Status: "pending"},
		{ID: "detect", Label: "Detect project", Weight: 5, Status: "pending"},
		{ID: "modules", Label: "Modules", Weight: 18, Status: "pending"},
		{ID: "build", Label: "Compile", Weight: 30, Status: "pending"},
		{ID: "promote", Label: "Promote binary", Weight: 6, Status: "pending"},
		{ID: "purge", Label: "Clean source", Weight: 5, Status: "pending"},
		{ID: "start", Label: "Start container", Weight: 10, Status: "pending"},
		{ID: "health", Label: "Health check", Weight: 8, Status: "pending"},
	}
}

// DeleteGroupSteps is the group teardown pipeline.
func DeleteGroupSteps() []ProgressStep {
	return []ProgressStep{
		{ID: "inventory", Label: "Measure disk", Weight: 15, Status: "pending"},
		{ID: "services", Label: "Remove services", Weight: 45, Status: "pending"},
		{ID: "containers", Label: "Sweep containers", Weight: 20, Status: "pending"},
		{ID: "tree", Label: "Delete group tree", Weight: 20, Status: "pending"},
	}
}

// StartServiceSteps is a lightweight start/restart pipeline.
func CreateGroupSteps() []ProgressStep {
	return []ProgressStep{
		{ID: "prepare", Label: "Validate name", Weight: 40, Status: "pending"},
		{ID: "write", Label: "Create folder", Weight: 60, Status: "pending"},
	}
}

func GitHubConnectSteps() []ProgressStep {
	return []ProgressStep{
		{ID: "verify", Label: "Verify token", Weight: 70, Status: "pending"},
		{ID: "save", Label: "Save on Pi", Weight: 30, Status: "pending"},
	}
}

func StartServiceSteps() []ProgressStep {
	return []ProgressStep{
		{ID: "start", Label: "Start container", Weight: 70, Status: "pending"},
		{ID: "health", Label: "Verify health", Weight: 30, Status: "pending"},
	}
}

// CreatePostgresSteps is the shared-engine database provision pipeline.
func CreatePostgresSteps() []ProgressStep {
	return []ProgressStep{
		{ID: "prepare", Label: "Validate", Weight: 10, Status: "pending"},
		{ID: "engine", Label: "Postgres engine", Weight: 25, Status: "pending"},
		{ID: "database", Label: "Create database", Weight: 40, Status: "pending"},
		{ID: "register", Label: "Register service", Weight: 25, Status: "pending"},
	}
}

func (m *Manager) startProgress(steps []ProgressStep) {
	if m == nil || m.Activity == nil {
		return
	}
	m.Activity.StartProgress(steps)
}

func (m *Manager) stepProgress(id string) {
	if m == nil || m.Activity == nil {
		return
	}
	m.Activity.Advance(id)
}

func (m *Manager) skipProgress(id string) {
	if m == nil || m.Activity == nil {
		return
	}
	m.Activity.Skip(id)
}

func (m *Manager) detailProgress(detail string) {
	if m == nil || m.Activity == nil {
		return
	}
	m.Activity.SetDetail(detail)
}

func formatRemaining(pending int) string {
	switch {
	case pending <= 0:
		return "Finishing…"
	case pending == 1:
		return "1 step left"
	default:
		return fmt.Sprintf("%d steps left", pending)
	}
}
