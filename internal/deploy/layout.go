package deploy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CanvasLayout stores free-form node positions for a group's Railway-style canvas.
type CanvasLayout struct {
	Nodes map[string]CanvasNode `json:"nodes"`
}

type CanvasNode struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func (m *Manager) layoutPath(group string) string {
	return filepath.Join(m.groupDir(group), "layout.json")
}

func (m *Manager) GetCanvasLayout(group string) (CanvasLayout, error) {
	group = strings.TrimSpace(group)
	if err := requireSlug(group, "group"); err != nil {
		return CanvasLayout{}, err
	}
	reg, err := m.loadRegistry()
	if err != nil {
		return CanvasLayout{}, err
	}
	if _, idx := findGroup(reg, group); idx < 0 {
		return CanvasLayout{}, fmt.Errorf("group not found")
	}
	b, err := os.ReadFile(m.layoutPath(group))
	if err != nil {
		if os.IsNotExist(err) {
			return CanvasLayout{Nodes: map[string]CanvasNode{}}, nil
		}
		return CanvasLayout{}, err
	}
	var lay CanvasLayout
	if json.Unmarshal(b, &lay) != nil || lay.Nodes == nil {
		lay.Nodes = map[string]CanvasNode{}
	}
	return lay, nil
}

func (m *Manager) SaveCanvasLayout(group string, lay CanvasLayout) (CanvasLayout, error) {
	group = strings.TrimSpace(group)
	if err := requireSlug(group, "group"); err != nil {
		return CanvasLayout{}, err
	}
	reg, err := m.loadRegistry()
	if err != nil {
		return CanvasLayout{}, err
	}
	if _, idx := findGroup(reg, group); idx < 0 {
		return CanvasLayout{}, fmt.Errorf("group not found")
	}
	if lay.Nodes == nil {
		lay.Nodes = map[string]CanvasNode{}
	}
	// Drop positions for services that no longer exist.
	alive := map[string]bool{}
	for _, s := range reg.Services {
		if s.Group == group {
			alive[s.Slug] = true
		}
	}
	clean := CanvasLayout{Nodes: map[string]CanvasNode{}}
	for slug, n := range lay.Nodes {
		if !alive[slug] {
			continue
		}
		if n.X < 0 {
			n.X = 0
		}
		if n.Y < 0 {
			n.Y = 0
		}
		if n.X > 8000 {
			n.X = 8000
		}
		if n.Y > 8000 {
			n.Y = 8000
		}
		clean.Nodes[slug] = n
	}
	if err := os.MkdirAll(m.groupDir(group), 0o755); err != nil {
		return CanvasLayout{}, err
	}
	b, err := json.MarshalIndent(clean, "", "  ")
	if err != nil {
		return CanvasLayout{}, err
	}
	if err := os.WriteFile(m.layoutPath(group), b, 0o644); err != nil {
		return CanvasLayout{}, err
	}
	return clean, nil
}
