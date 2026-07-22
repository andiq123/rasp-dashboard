package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAttachDeploymentsSingleReadActiveBeyondRecent(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	group, slug := "g1", "svc1"
	svcDir := filepath.Join(dir, "groups", group, slug)
	if err := os.MkdirAll(filepath.Join(svcDir, "out", "builds"), 0o755); err != nil {
		t.Fatal(err)
	}
	svc := Service{Group: group, Slug: slug, Name: "Svc", Type: TypeGo}

	active, err := m.StartDeployment(svc, "active")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.PromoteDeployment(group, slug, active.ID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 6; i++ {
		d, err := m.StartDeployment(svc, "fail")
		if err != nil {
			t.Fatal(err)
		}
		m.FailDeployment(group, slug, d.ID, "boom")
	}

	got := Service{Group: group, Slug: slug, Type: TypeGo}
	m.attachDeployments(&got)
	if got.ActiveDeployID != active.ID {
		t.Fatalf("active id = %q want %q deployments=%d", got.ActiveDeployID, active.ID, len(got.Deployments))
	}
	if len(got.Deployments) != 5 {
		t.Fatalf("want 5 recent deployments, got %d", len(got.Deployments))
	}
}
