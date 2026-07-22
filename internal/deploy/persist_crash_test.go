package deploy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPersistCrashAsyncSkipsDuplicateFailure(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	group, slug := "g1", "app"
	svcDir := m.serviceDir(group, slug)
	if err := os.MkdirAll(svcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	reg := registry{Services: []Service{{
		Group: group, Slug: slug, Type: TypeGo, Name: "App",
		Status: "failed", Running: false, LastError: "exit 1",
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}}}
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}

	snap := Service{Group: group, Slug: slug, LastError: "exit 1"}
	m.persistCrashAsync(snap)
	time.Sleep(150 * time.Millisecond)

	b, err := os.ReadFile(filepath.Join(m.DeployDir, "registry.json"))
	if err != nil {
		t.Fatal(err)
	}
	var after registry
	if err := json.Unmarshal(b, &after); err != nil {
		t.Fatal(err)
	}
	if len(after.Services) != 1 {
		t.Fatalf("services: %+v", after.Services)
	}
	first := after.Services[0].UpdatedAt

	m.persistCrashAsync(snap)
	time.Sleep(150 * time.Millisecond)

	b, err = os.ReadFile(filepath.Join(m.DeployDir, "registry.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &after); err != nil {
		t.Fatal(err)
	}
	if after.Services[0].UpdatedAt != first {
		t.Fatalf("duplicate persist rewrote registry: %s -> %s", first, after.Services[0].UpdatedAt)
	}
}
