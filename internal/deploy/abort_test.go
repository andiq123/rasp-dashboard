package deploy

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestAbortBuildingRemovesEmptyStub(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	group, slug := "g1", "svc1"
	svcDir := filepath.Join(dir, "groups", group, slug)
	if err := os.MkdirAll(svcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(svcDir, "meta.json"), []byte(`{}`), 0o644)
	reg := registry{
		Groups:   []Group{{Slug: group, Name: "G"}},
		Services: []Service{{Group: group, Slug: slug, Type: TypeGo, Name: "Svc", Status: "building"}},
	}
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}
	m.abortBuilding(group, slug, fmt.Errorf("boom"))
	reg2, err := m.loadRegistry()
	if err != nil {
		t.Fatal(err)
	}
	if _, idx := findService(reg2, group, slug); idx >= 0 {
		t.Fatalf("expected stub removed, still present")
	}
	if _, err := os.Stat(svcDir); !os.IsNotExist(err) {
		t.Fatalf("expected stub dir removed")
	}
}

func TestAbortBuildingKeepsClone(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	group, slug := "g1", "svc1"
	repo := filepath.Join(dir, "groups", group, slug, "repo", ".git")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	reg := registry{
		Groups:   []Group{{Slug: group, Name: "G"}},
		Services: []Service{{Group: group, Slug: slug, Type: TypeGo, Name: "Svc", Repo: "o/r", Status: "building"}},
	}
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}
	m.abortBuilding(group, slug, fmt.Errorf("compile failed"))
	reg2, _ := m.loadRegistry()
	svc, idx := findService(reg2, group, slug)
	if idx < 0 {
		t.Fatal("service should remain")
	}
	if svc.Status != "failed" {
		t.Fatalf("status=%s", svc.Status)
	}
	if _, err := os.Stat(filepath.Join(dir, "groups", group, slug, "repo", ".git")); err != nil {
		t.Fatal("clone should remain")
	}
}
