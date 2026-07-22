package deploy

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRenameGroupDisplayOnly(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	_ = os.MkdirAll(m.groupDir("findvibe"), 0o755)
	reg := registry{Groups: []Group{{Slug: "findvibe", Name: "FindVibe"}}}
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}
	g, err := m.RenameGroup(context.Background(), "findvibe", "Find Vibe")
	if err != nil {
		t.Fatal(err)
	}
	// slugify("Find Vibe") => find-vibe — full migrate
	if g.Slug != "find-vibe" {
		t.Fatalf("slug=%s", g.Slug)
	}
	if _, err := os.Stat(m.groupDir("find-vibe")); err != nil {
		t.Fatal("new dir missing")
	}
	if _, err := os.Stat(m.groupDir("findvibe")); !os.IsNotExist(err) {
		t.Fatal("old dir should be gone")
	}
}

func TestRenameGroupSameSlug(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	_ = os.MkdirAll(m.groupDir("acme"), 0o755)
	_ = m.saveRegistry(registry{Groups: []Group{{Slug: "acme", Name: "Acme"}}})
	g, err := m.RenameGroup(context.Background(), "acme", "ACME")
	if err != nil {
		t.Fatal(err)
	}
	if g.Slug != "acme" || g.Name != "ACME" {
		t.Fatalf("%+v", g)
	}
	_ = filepath.SkipDir
}
