package deploy

import (
	"errors"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Go deploy lifecycle (one path for Deploy + Redeploy):
//
//	plan → acquire job → mark building → prepare workspace (clone/reuse)
//	     → start deployment record → async build/promote/start
//	     → success: active + archive previous
//	     → failure: keep clone/cache, drop staging, clear stuck building
//
// Lessons baked in:
//   - Deploy with an existing slug is Redeploy (never "already exists").
//   - markBuilding never blocks prepare (always replace-allowed).
//   - Empty stubs are removed on abort; reusable clones are kept.
//   - Status "building" only while jobBusyScoped matches the service.

// goDeployPlan is the resolved intent before any disk or Docker work.
type goDeployPlan struct {
	Group   string
	Slug    string
	Name    string
	Request CreateGoRequest
	Reuse   bool // service (or orphan files) already present
}

func (p goDeployPlan) scope() string { return p.Group + "/" + p.Slug }

func (p goDeployPlan) title() string {
	if p.Reuse {
		return "Redeploy · " + p.Name
	}
	return "Deploy · " + p.Name
}

func (p goDeployPlan) successMsg(url string) string {
	if p.Reuse {
		return "Redeployed · " + url
	}
	return "Live at " + url
}

// CreateGo deploys a Go service. Same name as an existing service reuses it.
func (m *Manager) CreateGo(ctx context.Context, group string, in CreateGoRequest) (Service, error) {
	plan, err := m.planGoDeploy(group, in, "")
	if err != nil {
		return Service{}, err
	}
	return m.runGoDeploy(ctx, plan)
}

// Redeploy rebuilds an existing Go service, reusing clone + module cache.
func (m *Manager) Redeploy(ctx context.Context, group, slug string) (Service, error) {
	if err := requireSlug(group, "group"); err != nil {
		return Service{}, err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return Service{}, err
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return Service{}, err
	}
	svc, idx := findService(reg, group, slug)
	m.mu.Unlock()
	if idx < 0 {
		return Service{}, fmt.Errorf("service not found")
	}
	if svc.Type != TypeGo {
		return Service{}, fmt.Errorf("only go services redeploy")
	}
	plan, err := m.planGoDeploy(group, CreateGoRequest{
		Repo: svc.Repo, Branch: svc.Branch, Name: svc.Name,
		LinkedDatabase: svc.LinkedDatabase, RootDir: svc.RootDir, BuildCmd: svc.BuildCmd,
		GoToolchain: svc.GoToolchain, MemoryMB: svc.MemoryMB, CPUs: svc.CPUs,
	}, slug)
	if err != nil {
		return Service{}, err
	}
	plan.Reuse = true
	return m.runGoDeploy(ctx, plan)
}

// planGoDeploy resolves name/slug and whether we will reuse an existing slot.
// forceSlug keeps Redeploy on the exact registry slug (name edits don't retarget).
func (m *Manager) planGoDeploy(group string, in CreateGoRequest, forceSlug string) (goDeployPlan, error) {
	if err := requireSlug(group, "group"); err != nil {
		return goDeployPlan{}, err
	}
	repo := normalizeRepo(in.Repo)
	name := strings.TrimSpace(in.Name)
	if name == "" && repo != "" {
		name = repo[strings.LastIndex(repo, "/")+1:]
	}
	if name == "" {
		return goDeployPlan{}, fmt.Errorf("name or repo required")
	}
	slug := strings.TrimSpace(forceSlug)
	if slug == "" {
		slug = slugify(name)
		if slug == "" && repo != "" {
			slug = slugify(repo[strings.LastIndex(repo, "/")+1:])
		}
	}
	if slug == "" {
		return goDeployPlan{}, fmt.Errorf("invalid name")
	}
	in.Name = name
	if in.Repo == "" {
		in.Repo = repo
	}
	reuse := m.serviceExists(group, slug)
	if !reuse {
		// Orphan dir from a prior failed attempt — still reuse disk.
		if st, err := os.Stat(m.serviceDir(group, slug)); err == nil && st.IsDir() {
			reuse = true
		}
	}
	return goDeployPlan{
		Group:   group,
		Slug:    slug,
		Name:    name,
		Request: in,
		Reuse:   reuse,
	}, nil
}

// runGoDeploy is the single Deploy/Redeploy pipeline.
func (m *Manager) runGoDeploy(ctx context.Context, plan goDeployPlan) (Service, error) {
	if err := m.acquireJob(plan.title(), plan.scope()); err != nil {
		return Service{}, err
	}

	if plan.Reuse {
		m.logf("info", "Reusing %s — clone & module cache kept when present", plan.scope())
	} else {
		m.logf("info", "New service %s", plan.scope())
	}

	m.markBuilding(plan.Group, plan.Slug, plan.Name)

	svc, buildDir, err := m.createGo(ctx, plan.Group, plan.Request, true)
	if err != nil {
		return m.failGoDeployPrepare(plan, svc, err)
	}

	if svc.DeployID != "" {
		m.AttachDeploymentID(svc.DeployID)
		m.logf("info", "Deployment %s", svc.DeployID)
	}
	m.attachDeployments(&svc)
	m.finishGoDeployAsync(svc, buildDir, svc.DeployID, plan.successMsg(svc.URL))
	return svc, nil
}

func (m *Manager) failGoDeployPrepare(plan goDeployPlan, svc Service, err error) (Service, error) {
	m.abortBuilding(plan.Group, plan.Slug, err)
	if svc.Group == "" {
		svc.Group = plan.Group
		svc.Slug = plan.Slug
		svc.Name = plan.Name
	}
	m.applyDisk(&svc)
	m.releaseJob(false, classifyDeployErr(err, svc))
	return svc, err
}

// markBuilding publishes status=building immediately so UI never flashes Failed mid-job.
func (m *Manager) markBuilding(group, slug, name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 {
		svc = Service{Group: group, Slug: slug, Type: TypeGo, Name: name}
		reg.Services = append(reg.Services, svc)
		idx = len(reg.Services) - 1
	} else if name != "" {
		svc.Name = name
	}
	svc.Type = TypeGo
	svc.Status = "building"
	svc.LastError = ""
	svc.Running = false
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	reg.Services[idx] = svc
	_ = m.saveRegistry(reg)
	_ = m.writeMeta(svc)
}

func (m *Manager) serviceExists(group, slug string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return false
	}
	_, idx := findService(reg, group, slug)
	return idx >= 0
}

// abortBuilding clears a stuck building state after prepare fails.
// Keeps clone/cache for Redeploy; removes empty stubs with nothing reusable.
func (m *Manager) abortBuilding(group, slug string, cause error) {
	errMsg := ""
	if cause != nil {
		errMsg = strings.TrimSpace(cause.Error())
		if len(errMsg) > 400 {
			errMsg = errMsg[:400] + "…"
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 {
		return
	}
	d := m.serviceDisk(group, slug)
	reusable := d.HasClone || d.HasBinary || svc.Repo != "" || svc.Port > 0
	if !reusable {
		reg.Services = append(reg.Services[:idx], reg.Services[idx+1:]...)
		_ = m.saveRegistry(reg)
		_ = os.RemoveAll(m.serviceDir(group, slug))
		if m.Cache != nil {
			m.Cache.ForgetService(group, slug)
		}
		m.logf("info", "Removed empty stub %s/%s", group, slug)
		return
	}
	svc.Status = "failed"
	svc.LastError = errMsg
	svc.Running = false
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	reg.Services[idx] = svc
	_ = m.saveRegistry(reg)
	_ = m.writeMeta(svc)
	_ = os.RemoveAll(filepath.Join(m.serviceDir(group, slug), "out", "builds"))
	m.logf("info", "Prepare failed · clone/cache kept — Redeploy to retry")
}

// completeGoDeployLocked applies terminal success/failure after async build.
func (m *Manager) completeGoDeploy(svc Service, deployID string, buildErr error, okMsg string) {
	if m.isDeleting(svc.Group, svc.Slug) {
		stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		m.removeServiceContainers(stopCtx, svc.Group, svc.Slug)
		cancel()
		m.releaseJob(false, "Cancelled — service deleted")
		return
	}
	if buildErr != nil {
		if errors.Is(buildErr, context.Canceled) {
			buildErr = fmt.Errorf("build cancelled")
		}
		m.logCloneRetained(svc.Group, svc.Slug, buildErr)
		if deployID != "" {
			m.FailDeployment(svc.Group, svc.Slug, deployID, buildErr.Error())
		}
		svc.Status = "failed"
		svc.LastError = buildErr.Error()
		svc.Running = false
		svc.DeployID = deployID
		svc.ActiveDeployID = m.activeDeployID(svc.Group, svc.Slug)
		m.applyDisk(&svc)
		m.persistService(svc)
		m.releaseJob(false, classifyDeployErr(buildErr, svc))
		return
	}
	svc.LastError = ""
	svc.DeployID = deployID
	svc.ActiveDeployID = deployID
	if svc.Type == TypeGo && strings.TrimSpace(svc.Repo) != "" {
		if !svc.AutoDeploySet {
			svc.AutoDeploy = true
			svc.AutoDeploySet = true
		}
	}
	m.applyDisk(&svc)
	m.persistService(svc)
	if deployID != "" {
		if dpl, ok := m.findDeployment(svc.Group, svc.Slug, deployID); ok && dpl.Commit != "" {
			m.NoteSuccessfulDeploySHA(svc.Group, svc.Slug, dpl.Commit)
		}
	}
	if svc.Type == TypeGo && (m.tunnelWanted(svc.Group, svc.Slug) || svc.PublicURL != "" || m.readTunnelURL(svc.Group, svc.Slug) != "") {
		healCtx, healCancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer healCancel()
		if healed, err := m.EnsureTunnel(healCtx, svc.Group, svc.Slug); err != nil {
			m.logf("warn", "Tunnel heal %s/%s: %v", svc.Group, svc.Slug, err)
		} else if healed.Slug != "" {
			svc = healed
		}
	}
	if okMsg == "" {
		okMsg = fmt.Sprintf("Live at %s", svc.URL)
	}
	if svc.PublicURL != "" {
		okMsg = fmt.Sprintf("Live at %s", svc.PublicURL)
	}
	if deployID != "" {
		okMsg = okMsg + " · " + deployID
	}
	m.releaseJob(true, okMsg)
}
