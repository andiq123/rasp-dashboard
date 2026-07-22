package deploy

import (
	"strings"
	"testing"
)

func TestSuggestGoRoot(t *testing.T) {
	s, r := suggestGoRoot([]GoModuleRoot{{Path: "", HasGoMod: true}}, true)
	if s != "" || r == "" {
		t.Fatalf("root has mod: %q %q", s, r)
	}
	s, r = suggestGoRoot([]GoModuleRoot{
		{Path: "", HasGoMod: false},
		{Path: "backend", HasGoMod: true},
	}, false)
	if s != "backend" || !strings.Contains(r, "backend") {
		t.Fatalf("single: %q %q", s, r)
	}
	s, _ = suggestGoRoot([]GoModuleRoot{
		{Path: "", HasGoMod: false},
		{Path: "web", HasGoMod: true},
		{Path: "backend", HasGoMod: true},
	}, false)
	if s != "backend" {
		t.Fatalf("prefer backend, got %q", s)
	}
	s, r = suggestGoRoot([]GoModuleRoot{{Path: "", HasGoMod: false}}, false)
	if s != "" || !strings.Contains(r, "No go.mod") {
		t.Fatalf("none: %q %q", s, r)
	}
}

func TestGoModDir(t *testing.T) {
	if goModDir("go.mod") != "" {
		t.Fatal("root")
	}
	if goModDir("backend/go.mod") != "backend" {
		t.Fatal("backend")
	}
	if goModDir("services/api/go.mod") != "services/api" {
		t.Fatal("nested")
	}
}
