package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPlanGoDeployReusesExistingAndOrphan(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	group := "findvibe"
	if err := os.MkdirAll(m.groupDir(group), 0o755); err != nil {
		t.Fatal(err)
	}
	reg := registry{Groups: []Group{{Slug: group, Name: "FindVibe"}}}
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}

	plan, err := m.planGoDeploy(group, CreateGoRequest{Repo: "acme/FindVibeFiber", Name: "FindVibeFiber"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Slug != "findvibefiber" || plan.Reuse {
		t.Fatalf("fresh plan: %+v", plan)
	}
	if plan.title() != "Deploy · FindVibeFiber" {
		t.Fatalf("title %q", plan.title())
	}

	// Registry hit
	reg.Services = []Service{{Group: group, Slug: "findvibefiber", Type: TypeGo, Name: "FindVibeFiber"}}
	_ = m.saveRegistry(reg)
	plan, err = m.planGoDeploy(group, CreateGoRequest{Repo: "acme/FindVibeFiber", Name: "FindVibeFiber"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !plan.Reuse || plan.title() != "Redeploy · FindVibeFiber" {
		t.Fatalf("registry reuse: %+v title=%s", plan, plan.title())
	}

	// Orphan dir only
	reg.Services = nil
	_ = m.saveRegistry(reg)
	if err := os.MkdirAll(m.serviceDir(group, "findvibefiber"), 0o755); err != nil {
		t.Fatal(err)
	}
	plan, err = m.planGoDeploy(group, CreateGoRequest{Repo: "acme/FindVibeFiber", Name: "FindVibeFiber"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !plan.Reuse {
		t.Fatal("expected orphan dir reuse")
	}

	// Redeploy force slug
	plan, err = m.planGoDeploy(group, CreateGoRequest{Repo: "acme/x", Name: "Other"}, "findvibefiber")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Slug != "findvibefiber" {
		t.Fatalf("force slug: %s", plan.Slug)
	}
}

func TestSuccessMsg(t *testing.T) {
	p := goDeployPlan{Reuse: false, Name: "A"}
	if p.successMsg("http://x") != "Live at http://x" {
		t.Fatal(p.successMsg("http://x"))
	}
	p.Reuse = true
	if p.successMsg("http://x") != "Redeployed · http://x" {
		t.Fatal(p.successMsg("http://x"))
	}
}

func TestServiceDirHelper(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	want := filepath.Join(dir, "groups", "g", "s")
	if m.serviceDir("g", "s") != want {
		t.Fatal(m.serviceDir("g", "s"))
	}
}
