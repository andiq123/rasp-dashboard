package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCanvasLayoutSaveLoad(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	group := "demo"
	if err := os.MkdirAll(m.groupDir(group), 0o755); err != nil {
		t.Fatal(err)
	}
	reg := registry{
		Groups:   []Group{{Slug: group, Name: "Demo"}},
		Services: []Service{{Group: group, Slug: "api", Type: TypeGo, Name: "api"}},
	}
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}
	got, err := m.GetCanvasLayout(group)
	if err != nil || len(got.Nodes) != 0 {
		t.Fatalf("empty layout: %#v %v", got, err)
	}
	saved, err := m.SaveCanvasLayout(group, CanvasLayout{Nodes: map[string]CanvasNode{
		"api":   {X: 40, Y: 80},
		"ghost": {X: 1, Y: 1}, // dropped — not in registry
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Nodes) != 1 || saved.Nodes["api"].X != 40 {
		t.Fatalf("saved: %#v", saved)
	}
	b, err := os.ReadFile(filepath.Join(m.groupDir(group), "layout.json"))
	if err != nil || len(b) < 10 {
		t.Fatalf("file: %v", err)
	}
	again, err := m.GetCanvasLayout(group)
	if err != nil || again.Nodes["api"].Y != 80 {
		t.Fatalf("reload: %#v %v", again, err)
	}
}
