package deploy

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDeployHistoryPromoteArchiveFail(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	group, slug := "g1", "svc1"
	svcDir := filepath.Join(dir, "groups", group, slug)
	if err := os.MkdirAll(filepath.Join(svcDir, "out", "builds"), 0o755); err != nil {
		t.Fatal(err)
	}
	svc := Service{Group: group, Slug: slug, Name: "Svc", Type: "go", Repo: "o/r", Branch: "main"}

	d1, err := m.StartDeployment(svc, "abc1111")
	if err != nil {
		t.Fatal(err)
	}
	if d1.Status != DeployBuilding {
		t.Fatalf("want building, got %s", d1.Status)
	}
	if err := m.PromoteDeployment(group, slug, d1.ID); err != nil {
		t.Fatal(err)
	}
	list, err := m.ListDeployments(group, slug, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Status != DeployActive || !list[0].Active {
		t.Fatalf("after promote: %+v", list)
	}

	d2, err := m.StartDeployment(svc, "abc2222")
	if err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(m.stagingDir(group, slug, d2.ID), 0o755)
	if err := m.PromoteDeployment(group, slug, d2.ID); err != nil {
		t.Fatal(err)
	}
	list, _ = m.ListDeployments(group, slug, 0)
	if len(list) != 2 {
		t.Fatalf("want 2, got %d", len(list))
	}
	var active, archived int
	for _, d := range list {
		if d.Status == DeployActive {
			active++
			if d.ID != d2.ID {
				t.Fatalf("active should be d2 %s got %s", d2.ID, d.ID)
			}
		}
		if d.Status == DeployArchived {
			archived++
			if d.ID != d1.ID {
				t.Fatalf("archived should be d1")
			}
		}
	}
	if active != 1 || archived != 1 {
		t.Fatalf("active=%d archived=%d list=%+v", active, archived, list)
	}

	d3, err := m.StartDeployment(svc, "abc3333")
	if err != nil {
		t.Fatal(err)
	}
	m.FailDeployment(group, slug, d3.ID, "boom")
	list, _ = m.ListDeployments(group, slug, 0)
	var stillActive, failed bool
	for _, d := range list {
		if d.ID == d2.ID && d.Status == DeployActive {
			stillActive = true
		}
		if d.ID == d3.ID && d.Status == DeployFailed {
			failed = true
		}
	}
	if !stillActive || !failed {
		t.Fatalf("fail wiped active? list=%+v", list)
	}

	for i := 0; i < 10; i++ {
		d, err := m.StartDeployment(svc, "c")
		if err != nil {
			t.Fatal(err)
		}
		_ = os.MkdirAll(m.stagingDir(group, slug, d.ID), 0o755)
		if err := m.PromoteDeployment(group, slug, d.ID); err != nil {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
	}
	list, _ = m.ListDeployments(group, slug, 0)
	if len(list) > 8 {
		t.Fatalf("prune failed: %d", len(list))
	}
}
