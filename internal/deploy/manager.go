package deploy

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"firewifi/dashboard/internal/deploy/cache"
	"firewifi/dashboard/internal/infra"
)

type Manager struct {
	BaseDir   string
	DeployDir string
	TokenPath string
	Postgres  *infra.Postgres
	MinIO     *infra.MinIO
	Activity  *ActivityHub
	Cache     *cache.Store
	mu        sync.Mutex
	jobMu     sync.Mutex
	jobBusy   bool
	jobScope  string // group/slug or group while a job runs
	jobCancel context.CancelFunc
	deletedMu sync.Mutex
	deleting  map[string]struct{} // group/slug being removed — ignore late build completion
	stats     *statsHub
}

func NewManager(baseDir, homeDir string, pg *infra.Postgres, mn *infra.MinIO) *Manager {
	deployDir := filepath.Join(homeDir, "deployments")
	m := &Manager{
		BaseDir:   baseDir,
		DeployDir: deployDir,
		TokenPath: filepath.Join(baseDir, "config", "github.token"),
		Postgres:  pg,
		MinIO:     mn,
		Activity:  newActivityHub(),
		Cache:     cache.New(deployDir),
	}
	m.bindActivityPersist()
	go m.BootstrapQuickTunnels()
	go m.BootstrapAutoDeploy()
	go m.BootstrapStats()
	return m
}

// ActivitySnapshot returns the current deploy/ops console state.
func (m *Manager) ActivitySnapshot() ActivitySnapshot {
	if m == nil || m.Activity == nil {
		return ActivitySnapshot{Lines: []ActivityLine{}}
	}
	return m.Activity.Snapshot()
}

// SubscribeActivity fans out live activity updates for SSE.
func (m *Manager) SubscribeActivity() (<-chan ActivitySnapshot, func()) {
	if m == nil || m.Activity == nil {
		ch := make(chan ActivitySnapshot)
		close(ch)
		return ch, func() {}
	}
	return m.Activity.Subscribe()
}

func (m *Manager) acquireJob(title, scope string) error {
	return m.acquireJobDeploy(title, scope, "")
}

func (m *Manager) acquireJobDeploy(title, scope, deployID string) error {
	m.jobMu.Lock()
	defer m.jobMu.Unlock()
	if m.jobBusy {
		return fmt.Errorf("another job is already running — wait for it to finish")
	}
	m.jobBusy = true
	m.jobScope = strings.TrimSpace(scope)
	if deployID != "" {
		m.beginJobDeploy(title, scope, deployID)
	} else {
		m.beginJob(title, scope)
	}
	return nil
}

func (m *Manager) jobBusyScoped(group, slug string) bool {
	m.jobMu.Lock()
	defer m.jobMu.Unlock()
	if !m.jobBusy {
		return false
	}
	want := strings.TrimSpace(group + "/" + slug)
	scope := strings.TrimSpace(m.jobScope)
	return scope == want || scope == group || strings.HasPrefix(scope, group+"/")
}

func (m *Manager) releaseJob(ok bool, msg string) {
	m.jobMu.Lock()
	if !m.jobBusy {
		m.jobMu.Unlock()
		return
	}
	m.jobBusy = false
	m.jobScope = ""
	cancel := m.jobCancel
	m.jobCancel = nil
	m.jobMu.Unlock()
	if cancel != nil {
		cancel()
	}
	m.endJob(ok, msg)
}

func (m *Manager) ensureDirs() error {
	if err := os.MkdirAll(m.DeployDir, 0o755); err != nil {
		return err
	}
	return os.MkdirAll(filepath.Dir(m.TokenPath), 0o755)
}

func requireSlug(s, label string) error {
	if !validSlug(s) {
		return fmt.Errorf("invalid %s", label)
	}
	return nil
}

// --- Groups ---

func (m *Manager) ListGroups(ctx context.Context) ([]Group, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return nil, err
	}
	_ = m.adoptOrphansLocked(&reg)
	out := make([]Group, 0, len(reg.Groups))
	for _, g := range reg.Groups {
		n := 0
		for _, s := range reg.Services {
			if s.Group == g.Slug {
				n++
			}
		}
		g.ServiceCount = n
		g.DiskBytes = dirSize(m.groupDir(g.Slug))
		out = append(out, g)
	}
	return out, nil
}

func (m *Manager) CreateGroup(ctx context.Context, name string) (Group, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Group{}, fmt.Errorf("name required")
	}
	slug := slugify(name)
	if slug == "" {
		return Group{}, fmt.Errorf("invalid name")
	}
	if err := m.acquireJob("Create group · "+name, slug); err != nil {
		return Group{}, err
	}
	m.startProgress(CreateGroupSteps())
	m.stepProgress("prepare")
	m.logf("info", "Slug %s", slug)

	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	if _, idx := findGroup(reg, slug); idx >= 0 {
		m.mu.Unlock()
		err := fmt.Errorf("group already exists: %s", slug)
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	m.stepProgress("write")
	m.logf("step", "Creating %s", m.groupDir(slug))
	// Layout: deployments/groups/<group>/{env, <service>/…}
	if err := os.MkdirAll(m.groupDir(slug), 0o755); err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	_ = os.WriteFile(filepath.Join(m.groupDir(slug), "env"), []byte(""), 0o600)
	g := Group{Slug: slug, Name: name, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
	reg.Groups = append(reg.Groups, g)
	if err := m.saveRegistry(reg); err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return Group{}, err
	}
	m.mu.Unlock()
	m.logf("ok", "Group folder ready")
	m.releaseJob(true, "Group ready · "+slug)
	return g, nil
}

func (m *Manager) DeleteGroup(ctx context.Context, group string) error {
	if err := requireSlug(group, "group"); err != nil {
		return err
	}
	// Snapshot services and cancel any in-flight builds before taking the job lock.
	m.mu.Lock()
	regPeek, errPeek := m.loadRegistry()
	var doomedPeek []Service
	if errPeek == nil {
		for _, s := range regPeek.Services {
			if s.Group == group {
				doomedPeek = append(doomedPeek, s)
			}
		}
	}
	m.mu.Unlock()
	for _, s := range doomedPeek {
		m.markDeleting(s.Group, s.Slug)
	}
	defer func() {
		for _, s := range doomedPeek {
			m.clearDeleting(s.Group, s.Slug)
		}
	}()
	for _, s := range doomedPeek {
		if s.Type == TypeGo {
			m.stopBuildForDelete(ctx, s.Group, s.Slug)
		}
	}

	if err := m.acquireJob("Delete group · "+group, group); err != nil {
		return err
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return err
	}
	if _, idx := findGroup(reg, group); idx < 0 {
		m.mu.Unlock()
		err := fmt.Errorf("group not found")
		m.releaseJob(false, err.Error())
		return err
	}
	var doomed []Service
	var keep []Service
	for _, s := range reg.Services {
		if s.Group == group {
			doomed = append(doomed, s)
			continue
		}
		keep = append(keep, s)
	}
	m.mu.Unlock()

	groupBytes := dirSize(m.groupDir(group))
	m.startProgress(DeleteGroupSteps())
	m.stepProgress("inventory")
	m.logf("step", "Tearing down group %s · %s on disk · %d service(s)", group, fmtBytes(groupBytes), len(doomed))
	m.stepProgress("services")
	var freed int64
	for _, s := range doomed {
		d := m.serviceDisk(s.Group, s.Slug)
		m.logf("step", "Service %s/%s (%s) · %s", s.Group, s.Slug, s.Type, fmtBytes(d.TotalBytes))
		if d.HasClone {
			m.logf("info", "  · source clone %s", fmtBytes(d.CloneBytes))
		}
		if d.BinaryBytes > 0 {
			m.logf("info", "  · binary/artifacts %s", fmtBytes(d.BinaryBytes))
		}
		m.mu.Lock()
		_ = m.deleteServiceLocked(ctx, reg, s)
		m.mu.Unlock()
		freed += d.TotalBytes
	}
	m.stepProgress("containers")
	m.logf("step", "Sweeping leftover containers for group %s", group)
	m.removeGroupContainers(ctx, group)

	m.mu.Lock()
	reg, err = m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return err
	}
	reg.Services = keep
	next := reg.Groups[:0]
	for _, g := range reg.Groups {
		if g.Slug != group {
			next = append(next, g)
		}
	}
	reg.Groups = next
	left := dirSize(m.groupDir(group))
	m.stepProgress("tree")
	m.logf("step", "Deleting group tree %s · %s remaining", m.groupDir(group), fmtBytes(left))
	freed += m.logRemovePath("group files", m.groupDir(group))
	if m.Cache != nil {
		m.Cache.ForgetGroup(group)
		m.logf("info", "Cleared cache state for group %s (shared modules kept)", group)
	}
	if err := m.saveRegistry(reg); err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return err
	}
	m.mu.Unlock()
	m.releaseJob(true, fmt.Sprintf("Group removed · freed ~%s", fmtBytes(freed)))
	return nil
}

func (m *Manager) GetGroupEnv(group string) (string, string, error) {
	if err := requireSlug(group, "group"); err != nil {
		return "", "", err
	}
	body, err := os.ReadFile(filepath.Join(m.groupDir(group), "env"))
	if err != nil && !os.IsNotExist(err) {
		return "", "", err
	}
	text := string(body)
	return text, envToJSON(text), nil
}

func (m *Manager) UpdateGroup(ctx context.Context, group string, in GroupSettingsUpdate) (Group, error) {
	if err := requireSlug(group, "group"); err != nil {
		return Group{}, err
	}
	if in.Name != nil && strings.TrimSpace(*in.Name) != "" {
		g, err := m.RenameGroup(ctx, group, strings.TrimSpace(*in.Name))
		if err != nil {
			return Group{}, err
		}
		group = g.Slug
		if in.Env == nil {
			return g, nil
		}
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return Group{}, err
	}
	g, idx := findGroup(reg, group)
	if idx < 0 {
		m.mu.Unlock()
		return Group{}, fmt.Errorf("group not found")
	}
	var toRecreate []Service
	if in.Env != nil {
		path := filepath.Join(m.groupDir(group), "env")
		if err := os.MkdirAll(m.groupDir(group), 0o755); err != nil {
			m.mu.Unlock()
			return Group{}, err
		}
		if err := os.WriteFile(path, []byte(normalizeEnv(*in.Env)), 0o600); err != nil {
			m.mu.Unlock()
			return Group{}, err
		}
		for _, s := range reg.Services {
			if s.Group == group && s.Type == TypeGo {
				toRecreate = append(toRecreate, s)
			}
		}
	}
	g.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	reg.Groups[idx] = g
	if err := m.saveRegistry(reg); err != nil {
		m.mu.Unlock()
		return Group{}, err
	}
	m.mu.Unlock()
	for _, s := range toRecreate {
		if err := m.recreateGo(ctx, s); err != nil {
			return g, fmt.Errorf("group saved but restart %s failed: %w", s.Slug, err)
		}
	}
	return g, nil
}

// --- Services ---

func (m *Manager) ListServices(ctx context.Context, group string) ([]Service, error) {
	if group != "" {
		if err := requireSlug(group, "group"); err != nil {
			return nil, err
		}
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	_ = m.adoptOrphansLocked(&reg)
	snap := make([]Service, 0, len(reg.Services))
	for _, s := range reg.Services {
		if group != "" && s.Group != group {
			continue
		}
		snap = append(snap, s)
	}
	m.mu.Unlock()
	out := make([]Service, 0, len(snap))
	for _, s := range snap {
		s2 := m.refreshStatus(ctx, s)
		m.attachDeployments(&s2)
		out = append(out, s2)
	}
	return out, nil
}

func (m *Manager) Get(group, slug string) (Service, error) {
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return Service{}, err
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 {
		m.mu.Unlock()
		return Service{}, fmt.Errorf("service not found")
	}
	m.mu.Unlock()

	svc = m.refreshStatus(context.Background(), svc)
	m.attachDeployments(&svc)
	return svc, nil
}

func (m *Manager) GetEnv(group, slug string) (string, string, error) {
	if err := requireSlug(group, "group"); err != nil {
		return "", "", err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return "", "", err
	}
	body, err := os.ReadFile(filepath.Join(m.serviceDir(group, slug), "env"))
	if err != nil && !os.IsNotExist(err) {
		return "", "", err
	}
	text := string(body)
	return text, envToJSON(text), nil
}

func (m *Manager) CreatePostgres(ctx context.Context, group string, name, version string) (Service, error) {
	name = strings.TrimSpace(name)
	scope := group + "/" + slugify(name)
	if err := m.acquireJob("Create database · "+name, scope); err != nil {
		return Service{}, err
	}
	m.startProgress(CreatePostgresSteps())
	svc, err := m.createPostgres(ctx, group, name, version)
	if err != nil {
		m.releaseJob(false, err.Error())
		return Service{}, err
	}
	m.logf("ok", "Ready · link Go apps to get DB_* + DATABASE_URL")
	m.releaseJob(true, "Database ready · "+svc.Slug)
	return svc, nil
}

func (m *Manager) createPostgres(ctx context.Context, group string, name, version string) (Service, error) {
	m.stepProgress("prepare")
	m.detailProgress("Checking group")
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Postgres == nil {
		return Service{}, fmt.Errorf("postgres engine not configured")
	}
	reg, err := m.loadRegistry()
	if err != nil {
		return Service{}, err
	}
	if _, idx := findGroup(reg, group); idx < 0 {
		return Service{}, fmt.Errorf("group not found — create a group first")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Service{}, fmt.Errorf("name required")
	}
	slug := slugify(name)
	if slug == "" {
		return Service{}, fmt.Errorf("invalid name")
	}
	if _, idx := findService(reg, group, slug); idx >= 0 {
		return Service{}, fmt.Errorf("service already exists in group")
	}
	m.logf("info", "New database · %s/%s", group, slug)

	m.stepProgress("engine")
	m.detailProgress("Ensuring engine")
	version = strings.TrimSpace(version)
	if version != "" {
		if err := m.applyPostgresVersionLocked(ctx, version); err != nil {
			return Service{}, err
		}
	} else {
		eng := m.LoadEngine()
		m.logf("info", "Engine %s · %s", eng.PostgresVersion, postgresImageFor(eng.PostgresVersion))
	}
	// Unlock briefly for docker start / create (can be slow).
	m.mu.Unlock()
	m.logf("step", "Starting Postgres engine if needed")
	m.detailProgress("Waiting until healthy")
	if err := m.Postgres.Start(ctx); err != nil {
		m.mu.Lock()
		return Service{}, fmt.Errorf("engine: %w", err)
	}
	m.logf("ok", "Engine healthy · ready for psql")
	m.detailProgress("Waiting for stable connections")
	if err := m.Postgres.WaitHealthy(ctx, 45*time.Second); err != nil {
		m.mu.Lock()
		return Service{}, fmt.Errorf("engine: %w", err)
	}

	dbName := strings.ReplaceAll(group+"_"+slug, "-", "_")
	if len(dbName) > 60 {
		dbName = dbName[:60]
	}
	m.stepProgress("database")
	m.detailProgress(dbName)
	m.logf("step", "Creating role + database %s", dbName)
	db, err := m.Postgres.CreateDatabase(ctx, dbName)
	m.mu.Lock()
	if err != nil {
		return Service{}, err
	}
	m.logf("ok", "Database %s created", db.Name)

	m.stepProgress("register")
	m.detailProgress("Writing env")
	m.logf("info", "Writing connection env · %s/%s", group, slug)
	dir := m.serviceDir(group, slug)
	if err := m.ensureServiceLayout(group, slug); err != nil {
		_ = m.Postgres.DropDatabase(ctx, db.Name)
		return Service{}, err
	}
	envBody := ensureProductionEnv(postgresServiceEnv(db.URL, db.Name, db.User, db.Password))
	if err := os.WriteFile(filepath.Join(dir, "env"), []byte(envBody), 0o600); err != nil {
		_ = m.Postgres.DropDatabase(ctx, db.Name)
		return Service{}, err
	}
	svc := Service{
		Group: group, Slug: slug, Type: TypePostgres, Name: name,
		Running: true, ConnectionURL: db.URL, Database: db.Name,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	reg.Services = append(reg.Services, svc)
	if err := m.saveRegistry(reg); err != nil {
		_ = m.Postgres.DropDatabase(ctx, db.Name)
		return Service{}, err
	}
	_ = m.writeMeta(svc)
	m.logf("ok", "Registered · connection string on service card")
	return svc, nil
}

// applyPostgresVersionLocked updates the shared engine image when version changes.
// Caller must hold m.mu. Logs into the current activity job (no nested job).
func (m *Manager) applyPostgresVersionLocked(ctx context.Context, version string) error {
	if !validPostgresVersion(version) {
		return fmt.Errorf("unsupported postgres version %q", version)
	}
	cur := m.LoadEngine()
	if cur.PostgresVersion == version {
		m.logf("info", "Engine already %s · %s", version, postgresImageFor(version))
		return nil
	}
	next := cur
	next.PostgresVersion = version
	if err := m.saveEngine(next); err != nil {
		return err
	}
	img := postgresImageFor(version)
	m.logf("step", "Switching engine → %s (%s)", version, img)
	if m.Postgres == nil {
		return fmt.Errorf("postgres engine not configured")
	}
	// SetImage may talk to docker; release lock for duration.
	m.mu.Unlock()
	err := m.Postgres.SetImage(ctx, img)
	m.mu.Lock()
	if err != nil {
		return err
	}
	m.logf("ok", "Engine image %s", img)
	return nil
}

func (m *Manager) createGo(ctx context.Context, group string, in CreateGoRequest, allowReplace bool) (Service, string, error) {
	if err := requireSlug(group, "group"); err != nil {
		return Service{}, "", err
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return Service{}, "", err
	}
	if _, idx := findGroup(reg, group); idx < 0 {
		m.mu.Unlock()
		return Service{}, "", fmt.Errorf("group not found — create a group first")
	}
	repo := normalizeRepo(in.Repo)
	if repo == "" {
		m.mu.Unlock()
		return Service{}, "", fmt.Errorf("repo required")
	}
	branch := strings.TrimSpace(in.Branch)
	if branch == "" {
		branch = defaultBranch
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = repo[strings.LastIndex(repo, "/")+1:]
	}
	slug := slugify(name)
	if slug == "" {
		slug = slugify(repo[strings.LastIndex(repo, "/")+1:])
	}
	token, err := m.readToken()
	if err != nil || token == "" {
		m.mu.Unlock()
		return Service{}, "", fmt.Errorf("github not connected")
	}
	link := strings.TrimSpace(in.LinkedDatabase)
	var linkURL string
	if link != "" {
		dbSvc, di := findService(reg, group, link)
		if di < 0 || dbSvc.Type != TypePostgres {
			m.mu.Unlock()
			return Service{}, "", fmt.Errorf("linked database must be a postgres service in this group")
		}
		linkURL = m.readServiceDATABASEURL(group, link)
		if linkURL == "" {
			m.mu.Unlock()
			return Service{}, "", fmt.Errorf("linked database has no DATABASE_URL")
		}
	}
	blink := strings.TrimSpace(in.LinkedBucket)
	if blink != "" {
		bSvc, bi := findService(reg, group, blink)
		if bi < 0 || bSvc.Type != TypeBucket {
			m.mu.Unlock()
			return Service{}, "", fmt.Errorf("linked bucket must be a bucket service in this group")
		}
	}

	existing, existIdx := findService(reg, group, slug)
	if existIdx >= 0 && !allowReplace {
		m.mu.Unlock()
		return Service{}, "", fmt.Errorf("service %s already exists — open it and Redeploy, or choose another name", slug)
	}
	dir := m.serviceDir(group, slug)
	repoDir := filepath.Join(dir, "repo")
	if err := m.ensureServiceLayout(group, slug); err != nil {
		m.mu.Unlock()
		return Service{}, "", err
	}

	buildCmd := strings.TrimSpace(in.BuildCmd)
	mem, cpus := clampResources(in.MemoryMB, in.CPUs)
	port := 0
	if existing.Port > 0 {
		port = existing.Port
	}
	hadClone := false
	if st, e := os.Stat(filepath.Join(repoDir, ".git")); e == nil && st.IsDir() {
		hadClone = true
	}
	// Release lock during slow clone/build.
	m.mu.Unlock()

	m.startProgress(DeployGoSteps())
	m.stepProgress("prepare")
	if existIdx >= 0 {
		m.logf("ok", "Reusing service slot %s/%s", group, slug)
	}
	m.stepProgress("clone")
	if hadClone {
		m.logf("step", "Updating clone %s @ %s", repo, branch)
	} else {
		m.logf("step", "Cloning %s @ %s", repo, branch)
	}
	if err := m.cloneOrPull(ctx, repoDir, repo, branch, token); err != nil {
		return Service{}, "", err
	}
	m.logf("ok", "Source ready")
	m.stepProgress("detect")
	rootDir := strings.TrimSpace(in.RootDir)
	buildDir, rootDir, err := resolveRootDir(repoDir, rootDir)
	if err != nil {
		return Service{}, "", err
	}
	if rootDir != "" {
		m.logf("info", "Using root directory /%s", rootDir)
	}
	manifest, err := readManifestJSON(buildDir)
	if err != nil {
		return Service{}, "", err
	}
	if manifest.Cmd == "" && manifest.BuildCmd == "" && manifest.Port == 0 && manifest.MemoryMB == 0 && manifest.CPUs == 0 && manifest.RootDir == "" {
		if m2, err2 := readManifestJSON(repoDir); err2 == nil {
			manifest = m2
		}
	}
	if rootDir == "" && strings.TrimSpace(manifest.RootDir) != "" {
		buildDir, rootDir, err = resolveRootDir(repoDir, manifest.RootDir)
		if err != nil {
			return Service{}, "", err
		}
	}
	audit := auditGoModule(buildDir)
	cmdPath := strings.TrimSpace(manifest.Cmd)
	if cmdPath == "" {
		cmdPath = audit.Cmd
	}
	if cmdPath == "" {
		return Service{}, "", fmt.Errorf("no go main package found in repo (checked ./cmd/*, ./cmd, ., .air.toml)")
	}
	if strings.TrimSpace(manifest.Cmd) == "" && audit.Reason != "" {
		m.logf("info", "Detected entrypoint %s (%s)", cmdPath, audit.Reason)
	} else {
		m.logf("info", "Entrypoint %s", cmdPath)
	}
	if audit.GoVersion != "" {
		m.logf("info", "Go %s · image %s", audit.GoVersion, audit.Image)
	}
	if buildCmd == "" {
		buildCmd = strings.TrimSpace(manifest.BuildCmd)
	}
	if buildCmd != "" {
		if err := validateBuildCmd(buildCmd); err != nil {
			return Service{}, "", err
		}
	}
	if in.MemoryMB <= 0 && manifest.MemoryMB > 0 {
		mem = manifest.MemoryMB
	}
	if in.CPUs <= 0 && manifest.CPUs > 0 {
		cpus = manifest.CPUs
	}
	mem, cpus = clampResources(mem, cpus)
	// Always audit host ports. Never trust manifest/user PORT for binding.
	_ = manifest.Port

	m.mu.Lock()
	reg, err = m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return Service{}, "", err
	}
	existing, existIdx = findService(reg, group, slug)
	keep := 0
	if existIdx >= 0 && existing.Port > 0 {
		keep = existing.Port
	}
	if keep > 0 {
		// Redeploy must keep the same host port so an existing quick tunnel
		// (cloudflared --url http://127.0.0.1:PORT) keeps working. Our own
		// running container will release the port when runGoContainer replaces it.
		conflict := false
		for _, s := range reg.Services {
			if s.Port == keep && !(s.Group == group && s.Slug == slug) {
				conflict = true
				break
			}
		}
		if conflict {
			m.logf("warn", "Port %d used by another service — assigning a free port", keep)
			keep = 0
		}
	}
	if keep > 0 {
		port = keep
	} else {
		port, err = m.pickPort(reg)
		if err != nil {
			m.mu.Unlock()
			return Service{}, "", err
		}
	}
	m.mu.Unlock()

	envPath := filepath.Join(dir, "env")
	envBody := ""
	if b, err := os.ReadFile(envPath); err == nil {
		envBody = string(b)
	}
	// Wizard / API may pass initial KEY=value or JSON env before first deploy.
	// PORT is always assigned by audit — strip any user PORT first.
	if strings.TrimSpace(in.Env) != "" {
		envBody = mergeEnvFiles(envBody, clearEnvKeys(normalizeEnv(in.Env), "PORT"))
	}
	envBody = clearEnvKeys(envBody, "PORT")
	envBody = upsertEnv(envBody, "PORT", fmt.Sprintf("%d", port))
	if link != "" {
		envBody = m.injectLinkedDatabase(envBody, group, link)
	} else if linkURL != "" {
		envBody = injectDatabaseURL(envBody, linkURL)
	}
	if blink != "" {
		envBody = m.injectLinkedBucket(envBody, group, blink)
	}
	envBody = ensureProductionEnv(envBody)
	_ = os.WriteFile(envPath, []byte(normalizeEnv(envBody)), 0o600)
	m.logf("info", "Port %d · %dMB · %.1f CPU%s", port, mem, cpus, func() string {
		if link != "" {
			return " · DB " + link
		}
		return ""
	}())

	if buildCmd != "" {
		var err error
		buildCmd, err = productionizeBuildCmd(buildCmd)
		if err != nil {
			return Service{}, "", err
		}
	}
	svc := Service{
		Group: group, Slug: slug, Type: TypeGo, Name: name,
		Repo: repo, Branch: branch, Port: port, Cmd: cmdPath,
		RootDir: rootDir, BuildCmd: buildCmd, MemoryMB: mem, CPUs: cpus,
		GoToolchain:    strings.TrimSpace(in.GoToolchain),
		LinkedDatabase: link, LinkedBucket: blink, URL: fmt.Sprintf("http://rasp.local:%d", port),
		Status: "building", UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		AutoDeploy: true, AutoDeploySet: true,
	}
	// Keep auto-deploy / tunnel state across redeploys.
	m.mu.Lock()
	if reg, err := m.loadRegistry(); err == nil {
		if prev, idx := findService(reg, group, slug); idx >= 0 {
			svc.AutoDeploy = prev.AutoDeploy
			svc.AutoDeploySet = prev.AutoDeploySet
			svc.DeploySHA = prev.DeploySHA
			svc.PublicURL = prev.PublicURL
			svc.StaticHost = prev.StaticHost
			svc.TunnelActive = prev.TunnelActive
			if !svc.AutoDeploySet {
				svc.AutoDeploy = true
				svc.AutoDeploySet = true
			}
		}
	}
	m.mu.Unlock()
	commit := gitHeadCommit(buildDir)
	dpl, err := m.StartDeployment(svc, commit)
	if err != nil {
		return Service{}, "", err
	}
	svc.DeployID = dpl.ID
	svc.ActiveDeployID = m.activeDeployID(group, slug)
	m.persistService(svc)
	m.logf("info", "Deployment %s · commit %s", dpl.ID, func() string {
		if commit != "" {
			return commit
		}
		return "unknown"
	}())
	m.logf("info", "Service registered — building in background")
	return svc, buildDir, nil
}

func (m *Manager) persistService(svc Service) {
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		return
	}
	if m.isDeleting(svc.Group, svc.Slug) {
		return
	}
	prev, idx := findService(reg, svc.Group, svc.Slug)
	if idx < 0 {
		// Do not resurrect a service removed while an async build was finishing.
		return
	}
	svc = mergeServicePreserve(prev, svc)
	reg.Services[idx] = svc
	_ = m.saveRegistry(reg)
	_ = m.writeMeta(svc)
}

// markBuilding updates registry immediately so polls never show Failed mid-deploy.
func (m *Manager) UpdateSettings(ctx context.Context, group, slug string, in SettingsUpdate) (Service, error) {
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
	if idx < 0 {
		m.mu.Unlock()
		return Service{}, fmt.Errorf("service not found")
	}
	recreate := false
	rebuild := false
	if in.Name != nil && strings.TrimSpace(*in.Name) != "" {
		svc.Name = strings.TrimSpace(*in.Name)
	}
	if in.Branch != nil && svc.Type == TypeGo {
		nb := strings.TrimSpace(*in.Branch)
		if nb == "" {
			nb = defaultBranch
		}
		if nb != svc.Branch {
			svc.Branch = nb
			rebuild = true
		}
	}
	if in.RootDir != nil && svc.Type == TypeGo {
		nr, err := normalizeRootDir(*in.RootDir)
		if err != nil {
			m.mu.Unlock()
			return Service{}, err
		}
		if nr != svc.RootDir {
			svc.RootDir = nr
			rebuild = true
		}
	}
	if in.BuildCmd != nil && svc.Type == TypeGo {
		cmd := strings.TrimSpace(*in.BuildCmd)
		if cmd != "" {
			var perr error
			cmd, perr = productionizeBuildCmd(cmd)
			if perr != nil {
				m.mu.Unlock()
				return Service{}, perr
			}
		}
		if err := validateBuildCmd(cmd); err != nil && cmd != "" {
			m.mu.Unlock()
			return Service{}, err
		}
		if cmd != svc.BuildCmd {
			svc.BuildCmd = cmd
			rebuild = true
		}
	}
	if in.MemoryMB != nil || in.CPUs != nil {
		mem, cpus := svc.MemoryMB, svc.CPUs
		if in.MemoryMB != nil {
			mem = *in.MemoryMB
		}
		if in.CPUs != nil {
			cpus = *in.CPUs
		}
		mem, cpus = clampResources(mem, cpus)
		if mem != svc.MemoryMB || cpus != svc.CPUs {
			svc.MemoryMB, svc.CPUs = mem, cpus
			recreate = true
		}
	}
	if in.AutoDeploy != nil && svc.Type == TypeGo {
		svc.AutoDeploy = *in.AutoDeploy
		svc.AutoDeploySet = true
	}
	if in.LinkedDatabase != nil && svc.Type == TypeGo {
		link := strings.TrimSpace(*in.LinkedDatabase)
		if link != "" {
			dbSvc, di := findService(reg, group, link)
			if di < 0 || dbSvc.Type != TypePostgres {
				m.mu.Unlock()
				return Service{}, fmt.Errorf("database must be in this group")
			}
			dbURL := m.readServiceDATABASEURL(group, link)
			if dbURL == "" {
				m.mu.Unlock()
				return Service{}, fmt.Errorf("linked database has no DATABASE_URL")
			}
			svc.LinkedDatabase = link
			envPath := filepath.Join(m.serviceDir(group, slug), "env")
			cur, _ := os.ReadFile(envPath)
			_ = os.WriteFile(envPath, []byte(m.injectLinkedDatabase(string(cur), group, link)), 0o600)
		} else {
			svc.LinkedDatabase = ""
			envPath := filepath.Join(m.serviceDir(group, slug), "env")
			cur, _ := os.ReadFile(envPath)
			_ = os.WriteFile(envPath, []byte(removeLinkedDBEnv(string(cur))), 0o600)
		}
		recreate = true
	}
	if in.LinkedBucket != nil && svc.Type == TypeGo {
		link := strings.TrimSpace(*in.LinkedBucket)
		if link != "" {
			bSvc, bi := findService(reg, group, link)
			if bi < 0 || bSvc.Type != TypeBucket {
				m.mu.Unlock()
				return Service{}, fmt.Errorf("bucket must be in this group")
			}
			svc.LinkedBucket = link
			envPath := filepath.Join(m.serviceDir(group, slug), "env")
			cur, _ := os.ReadFile(envPath)
			body := m.injectLinkedBucket(string(cur), group, link)
			if strings.TrimSpace(parseEnvMap(body)["BUCKET_URL"]) == "" {
				m.mu.Unlock()
				return Service{}, fmt.Errorf("linked bucket has no credentials")
			}
			_ = os.WriteFile(envPath, []byte(body), 0o600)
		} else {
			svc.LinkedBucket = ""
			envPath := filepath.Join(m.serviceDir(group, slug), "env")
			cur, _ := os.ReadFile(envPath)
			_ = os.WriteFile(envPath, []byte(removeLinkedBucketEnv(string(cur))), 0o600)
		}
		recreate = true
	}
	if in.Env != nil {
		path := filepath.Join(m.serviceDir(group, slug), "env")
		body := normalizeEnv(*in.Env)
		cur, _ := os.ReadFile(path)
		curNorm := normalizeEnv(string(cur))
		// Ignore blank env payloads when an env file already exists — prevents
		// accidental wipe if the UI saved before /env finished loading.
		if strings.TrimSpace(body) == "" && strings.TrimSpace(curNorm) != "" {
			body = curNorm
		} else {
			if svc.Type == TypeGo && svc.LinkedDatabase != "" {
				body = m.injectLinkedDatabase(body, group, svc.LinkedDatabase)
			}
			if svc.Type == TypeGo && svc.LinkedBucket != "" {
				body = m.injectLinkedBucket(body, group, svc.LinkedBucket)
			}
			if body != curNorm {
				if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
					m.mu.Unlock()
					return Service{}, err
				}
				recreate = true
			}
		}
	}
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	reg.Services[idx] = svc
	if err := m.saveRegistry(reg); err != nil {
		m.mu.Unlock()
		return Service{}, err
	}
	_ = m.writeMeta(svc)
	m.mu.Unlock()

	if svc.Type == TypeGo {
		if rebuild {
			m.logf("info", "Code settings changed — full redeploy (pull & build)")
			return m.Redeploy(ctx, group, slug)
		}
		if recreate {
			m.logf("info", "Env/limits/DB link changed — restart only (no rebuild)")
			if err := m.recreateGo(ctx, svc); err != nil {
				return m.refreshStatus(ctx, svc), err
			}
		}
	}
	return m.refreshStatus(ctx, svc), nil
}

func (m *Manager) finishGoDeployAsync(svc Service, buildDir, deployID, okMsg string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	m.registerJobCancel(cancel)
	go func() {
		defer m.clearJobCancel(cancel)
		defer cancel()
		m.logf("info", "Background build started — logs keep updating here")
		err := m.buildAndRunGo(ctx, svc, buildDir, deployID)
		if m.isDeleting(svc.Group, svc.Slug) {
			stopCtx, stopCancel := context.WithTimeout(context.Background(), 45*time.Second)
			m.removeServiceContainers(stopCtx, svc.Group, svc.Slug)
			stopCancel()
			if deployID != "" {
				m.FailDeployment(svc.Group, svc.Slug, deployID, "cancelled — service deleted")
			}
			m.releaseJob(false, "Cancelled — service deleted")
			return
		}
		if err == nil {
			svc.Running = m.containerRunning(ctx, containerName(svc.Group, svc.Slug))
			if svc.Running {
				svc.Status = "running"
				m.logf("ok", "Container running")
			} else {
				svc.Status = "stopped"
				m.logf("warn", "Container not reported running yet")
			}
		}
		m.completeGoDeploy(svc, deployID, err, okMsg)
	}()
}

func (m *Manager) Start(ctx context.Context, group, slug string) error {
	if err := m.acquireJob("Start · "+slug, group+"/"+slug); err != nil {
		return err
	}
	m.startProgress(StartServiceSteps())
	m.stepProgress("start")
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return err
	}
	svc, idx := findService(reg, group, slug)
	m.mu.Unlock()
	if idx < 0 {
		err := fmt.Errorf("service not found")
		m.releaseJob(false, err.Error())
		return err
	}
	var runErr error
	if svc.Type == TypePostgres {
		m.logf("step", "Starting shared Postgres engine")
		runErr = m.Postgres.Start(ctx)
	} else if svc.Type == TypeBucket {
		if m.MinIO == nil {
			runErr = fmt.Errorf("minio engine not configured")
		} else {
			m.logf("step", "Starting shared MinIO engine")
			runErr = m.MinIO.Start(ctx)
		}
	} else {
		m.logf("step", "Starting container")
		runErr = m.recreateGo(ctx, svc)
	}
	if runErr != nil {
		svc.Running = false
		svc.Status = "failed"
		svc.LastError = runErr.Error()
		svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		m.persistService(svc)
		m.logf("err", "Start failed · %s", runErr.Error())
		m.releaseJob(false, runErr.Error())
		return runErr
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if svc.Type == TypePostgres || svc.Type == TypeBucket {
		engineType := TypePostgres
		addr := "127.0.0.1:5432"
		if svc.Type == TypeBucket {
			engineType = TypeBucket
			addr = "127.0.0.1:9000"
		}
		m.mu.Lock()
		reg2, err2 := m.loadRegistry()
		if err2 == nil {
			for i := range reg2.Services {
				if reg2.Services[i].Type == engineType {
					reg2.Services[i].Running = true
					reg2.Services[i].Status = "running"
					reg2.Services[i].LastError = ""
					reg2.Services[i].UpdatedAt = now
					_ = m.writeMeta(reg2.Services[i])
				}
			}
			_ = m.saveRegistry(reg2)
		}
		m.mu.Unlock()
		m.stepProgress("health")
		m.logf("ok", "Engine running · %s", addr)
		m.releaseJob(true, "Engine started")
		return nil
	}
	svc.Running = true
	svc.Status = "running"
	svc.LastError = ""
	svc.UpdatedAt = now
	m.persistService(svc)
	m.stepProgress("health")
	m.logf("ok", "Running · %s", svc.URL)
	m.releaseJob(true, "Started · "+svc.URL)
	return nil
}

func (m *Manager) Stop(ctx context.Context, group, slug string) error {
	if err := m.acquireJob("Stop · "+slug, group+"/"+slug); err != nil {
		return err
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return err
	}
	svc, idx := findService(reg, group, slug)
	m.mu.Unlock()
	if idx < 0 {
		err := fmt.Errorf("service not found")
		m.releaseJob(false, err.Error())
		return err
	}
	if svc.Type == TypePostgres || svc.Type == TypeBucket {
		engineType := TypePostgres
		label := "Postgres"
		hint := "database"
		var stopErr error
		if svc.Type == TypeBucket {
			engineType = TypeBucket
			label = "MinIO"
			hint = "bucket"
			if m.MinIO == nil {
				err := fmt.Errorf("minio engine not configured")
				m.releaseJob(false, err.Error())
				return err
			}
			m.logf("step", "Stopping shared MinIO engine (all buckets offline)")
			stopErr = m.MinIO.Stop(ctx)
		} else {
			if m.Postgres == nil {
				err := fmt.Errorf("postgres engine not configured")
				m.releaseJob(false, err.Error())
				return err
			}
			m.logf("step", "Stopping shared Postgres engine (all databases offline)")
			stopErr = m.Postgres.Stop(ctx)
		}
		if stopErr != nil {
			m.releaseJob(false, stopErr.Error())
			return stopErr
		}
		now := time.Now().UTC().Format(time.RFC3339)
		m.mu.Lock()
		reg, err = m.loadRegistry()
		if err != nil {
			m.mu.Unlock()
			m.releaseJob(false, err.Error())
			return err
		}
		for i := range reg.Services {
			if reg.Services[i].Type == engineType {
				reg.Services[i].Running = false
				reg.Services[i].Status = "stopped"
				reg.Services[i].UpdatedAt = now
				_ = m.writeMeta(reg.Services[i])
			}
		}
		_ = m.saveRegistry(reg)
		m.mu.Unlock()
		m.logf("ok", "%s engine stopped · Start from any %s card", label, hint)
		m.releaseJob(true, "Engine stopped")
		return nil
	}
	name := containerName(group, slug)
	m.logf("step", "Stopping %s — container removed, CPU/RAM limits released", name)
	m.stopContainer(ctx, name)
	if m.containerRunning(ctx, name) {
		err := fmt.Errorf("container still running after stop")
		m.releaseJob(false, err.Error())
		return err
	}
	_ = os.Remove(filepath.Join(m.serviceDir(group, slug), "runtime.env"))
	svc.Running = false
	svc.Status = "stopped"
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.persistService(svc)
	m.logf("ok", "Stopped · binary kept — Start without rebuild")
	m.releaseJob(true, "Stopped")
	return nil
}

func (m *Manager) Restart(ctx context.Context, group, slug string) error {
	if err := m.acquireJob("Restart · "+slug, group+"/"+slug); err != nil {
		return err
	}
	m.startProgress(StartServiceSteps())
	m.stepProgress("start")
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.releaseJob(false, err.Error())
		return err
	}
	svc, idx := findService(reg, group, slug)
	m.mu.Unlock()
	if idx < 0 {
		err := fmt.Errorf("service not found")
		m.releaseJob(false, err.Error())
		return err
	}
	var runErr error
	if svc.Type == TypePostgres {
		if m.Postgres == nil {
			runErr = fmt.Errorf("postgres engine not configured")
		} else {
			m.logf("step", "Restarting shared Postgres engine")
			runErr = m.Postgres.Restart(ctx)
		}
	} else if svc.Type == TypeBucket {
		if m.MinIO == nil {
			runErr = fmt.Errorf("minio engine not configured")
		} else {
			m.logf("step", "Restarting shared MinIO engine")
			runErr = m.MinIO.Restart(ctx)
		}
	} else {
		m.logf("step", "Restarting container")
		runErr = m.restartGo(ctx, svc)
	}
	if runErr != nil {
		m.logf("err", "Restart failed · %s", runErr.Error())
		m.releaseJob(false, runErr.Error())
		return runErr
	}
	if svc.Type == TypePostgres || svc.Type == TypeBucket {
		engineType := TypePostgres
		if svc.Type == TypeBucket {
			engineType = TypeBucket
		}
		now := time.Now().UTC().Format(time.RFC3339)
		m.mu.Lock()
		reg2, err2 := m.loadRegistry()
		if err2 == nil {
			for i := range reg2.Services {
				if reg2.Services[i].Type == engineType {
					reg2.Services[i].Running = true
					reg2.Services[i].Status = "running"
					reg2.Services[i].LastError = ""
					reg2.Services[i].UpdatedAt = now
					_ = m.writeMeta(reg2.Services[i])
				}
			}
			_ = m.saveRegistry(reg2)
		}
		m.mu.Unlock()
		m.stepProgress("health")
		m.logf("ok", "Engine restarted")
		m.releaseJob(true, "Engine restarted")
		return nil
	}
	svc.Running = true
	svc.Status = "running"
	svc.LastError = ""
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.persistService(svc)
	m.stepProgress("health")
	m.logf("ok", "Restarted · %s", svc.URL)
	m.releaseJob(true, "Restarted")
	return nil
}

func (m *Manager) QueryDatabase(ctx context.Context, group, slug, sql string) (infra.QueryResult, error) {
	var empty infra.QueryResult
	if err := requireSlug(group, "group"); err != nil {
		return empty, err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return empty, err
	}
	if m.Postgres == nil {
		return empty, fmt.Errorf("postgres engine not configured")
	}
	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return empty, err
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 || svc.Type != TypePostgres {
		return empty, fmt.Errorf("postgres service not found")
	}
	envPath := filepath.Join(m.serviceDir(group, slug), "env")
	body, _ := os.ReadFile(envPath)
	mp := parseEnvMap(string(body))
	dbName := strings.TrimSpace(mp["DB_NAME"])
	if dbName == "" {
		dbName = strings.TrimSpace(svc.Database)
	}
	user := strings.TrimSpace(mp["DB_USER"])
	pass := mp["DB_PASSWORD"]
	if dbName == "" || user == "" {
		return empty, fmt.Errorf("database credentials missing on service")
	}
	return m.Postgres.Query(ctx, dbName, user, pass, sql)
}

func (m *Manager) Delete(ctx context.Context, group, slug string) error {
	if err := requireSlug(group, "group"); err != nil {
		return err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return err
	}
	m.markDeleting(group, slug)
	defer m.clearDeleting(group, slug)

	// If a deploy is in flight for this service, cancel it and free the job slot.
	if m.jobBusyScoped(group, slug) {
		m.stopBuildForDelete(ctx, group, slug)
	} else {
		// Orphan build containers from a crashed deploy.
		stopCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		m.removeServiceContainers(stopCtx, group, slug)
		cancel()
	}

	if err := m.acquireJob("Delete · "+slug, group+"/"+slug); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.releaseJob(false, err.Error())
		return err
	}
	svc, idx := findService(reg, group, slug)
	if idx < 0 {
		err := fmt.Errorf("service not found")
		m.releaseJob(false, err.Error())
		return err
	}
	wasBuilding := svc.Status == "building" || m.jobBusyScoped(group, slug)
	if wasBuilding {
		m.logf("step", "Cancelling active build, then removing all resources")
	} else {
		m.logf("step", "Removing container, database (if any), and files")
	}
	if err := m.deleteServiceLocked(ctx, reg, svc); err != nil {
		m.releaseJob(false, err.Error())
		return err
	}
	reg.Services = append(reg.Services[:idx], reg.Services[idx+1:]...)
	for i := range reg.Services {
		if reg.Services[i].Group == group && reg.Services[i].LinkedDatabase == slug {
			reg.Services[i].LinkedDatabase = ""
		}
		if reg.Services[i].Group == group && reg.Services[i].LinkedBucket == slug {
			reg.Services[i].LinkedBucket = ""
		}
	}
	if err := m.saveRegistry(reg); err != nil {
		m.releaseJob(false, err.Error())
		return err
	}
	if wasBuilding {
		m.releaseJob(true, "Removed · build stopped · disk freed")
	} else {
		m.releaseJob(true, "Removed · disk freed")
	}
	return nil
}

func (m *Manager) deleteServiceLocked(ctx context.Context, reg registry, svc Service) error {
	if svc.Type == TypeGo {
		_, _ = m.StopTunnel(ctx, svc.Group, svc.Slug)
		m.logf("info", "Stopping containers for %s/%s (runtime + build)", svc.Group, svc.Slug)
		m.removeServiceContainers(ctx, svc.Group, svc.Slug)
	}
	if svc.Type == TypePostgres && m.Postgres != nil && svc.Database != "" {
		m.logf("info", "Dropping database %s", svc.Database)
		_ = m.Postgres.DropDatabase(ctx, svc.Database)
	}
	if svc.Type == TypeBucket && m.MinIO != nil && svc.Bucket != "" {
		m.logf("info", "Deleting bucket %s", svc.Bucket)
		_ = m.MinIO.DeleteBucket(ctx, svc.Bucket)
	}
	if m.Cache != nil {
		m.Cache.ForgetService(svc.Group, svc.Slug)
	}
	dir := m.serviceDir(svc.Group, svc.Slug)
	d := m.serviceDisk(svc.Group, svc.Slug)
	if d.HasClone {
		m.logRemovePath("source clone", filepath.Join(dir, "repo"))
	}
	if d.BinaryBytes > 0 {
		m.logRemovePath("build output", filepath.Join(dir, "out"))
	}
	m.logRemovePath("service files", dir)
	return nil
}

func (m *Manager) restartGo(ctx context.Context, svc Service) error {
	// Fast path: recreate container from existing binary (env/resources).
	return m.recreateGo(ctx, svc)
}

func (m *Manager) refreshStatus(ctx context.Context, svc Service) Service {
	switch svc.Type {
	case TypeGo:
		name := containerName(svc.Group, svc.Slug)
		st := m.inspectContainer(ctx, name)
		svc.Running = st.Running && st.Status == "running" && !st.Restarting
		if svc.Port > 0 {
			svc.URL = fmt.Sprintf("http://rasp.local:%d", svc.Port)
		}
		m.syncTunnel(&svc)
		// Never clobber an in-flight deploy — UI must not flash Failed/Stopped mid-build.
		if svc.Status == "building" {
			if m.jobBusyScoped(svc.Group, svc.Slug) {
				svc.LastError = ""
			} else {
				// Stuck after crash / aborted prepare — free the UI and persist.
				svc.Status = "failed"
				if svc.LastError == "" {
					svc.LastError = "Deploy interrupted — Redeploy to retry"
				}
				m.persistInterruptedAsync(svc)
			}
		} else if st.Restarting || st.Status == "exited" || st.Status == "dead" {
			svc.Running = false
			svc.Status = "failed"
			logs, _ := m.TailContainerLogs(ctx, svc.Group, svc.Slug, 60)
			summary := summarizeCrash(logs)
			if summary != "" {
				svc.LastError = summary
			} else if svc.LastError == "" {
				svc.LastError = "App crashed — open Logs"
			}
			m.persistCrashAsync(svc)
		} else if svc.Running {
			svc.Status = "running"
			svc.LastError = ""
		} else if svc.LastError != "" || svc.Status == "failed" {
			svc.Status = "failed"
		} else {
			svc.Status = "stopped"
		}
	case TypePostgres:
		if m.Postgres != nil {
			st := m.Postgres.Status(ctx)
			svc.Running = st.Running
			svc.EngineImage = st.Image
			vol := m.Postgres.VolumeInfo(ctx)
			svc.Volume = vol.Name
			svc.VolumeSize = vol.Size
			svc.VolumeBytes = vol.SizeBytes
		}
		if svc.ConnectionURL == "" {
			svc.ConnectionURL = m.readServiceDATABASEURL(svc.Group, svc.Slug)
		}
		if svc.Running {
			svc.Status = "running"
		} else {
			svc.Status = "stopped"
		}
	case TypeBucket:
		if m.MinIO != nil {
			st := m.MinIO.Status(ctx)
			svc.Running = st.Running
			svc.EngineImage = st.Image
		}
		if u := m.readServiceBUCKETURL(svc.Group, svc.Slug); u != "" {
			svc.ConnectionURL = u
		} else if svc.ConnectionURL == "" && m.MinIO != nil {
			svc.ConnectionURL = m.MinIO.Status(ctx).Endpoint
		}
		if svc.Running {
			svc.Status = "running"
		} else {
			svc.Status = "stopped"
		}
	}
	svc.Stats = m.statsForService(svc)
	m.applyDisk(&svc)
	return svc
}

// PortUse is one occupied host port (registry, docker publish, or listener).
type PortUse struct {
	Port   int    `json:"port"`
	Source string `json:"source"` // service | docker | listen
	Label  string `json:"label,omitempty"`
}

// PortAudit is a snapshot of the app port range for the wizard.
type PortAudit struct {
	Next  int       `json:"next"`
	Start int       `json:"start"`
	End   int       `json:"end"`
	Used  []PortUse `json:"used"`
	Free  int       `json:"free"`
}

func (m *Manager) usedPorts(reg registry) map[int]PortUse {
	used := map[int]PortUse{}
	for _, s := range reg.Services {
		if s.Port <= 0 {
			continue
		}
		label := s.Group + "/" + s.Slug
		if s.Name != "" && s.Name != s.Slug {
			label = s.Name + " · " + label
		}
		used[s.Port] = PortUse{Port: s.Port, Source: "service", Label: label}
	}
	ctx := context.Background()
	out, err := exec.CommandContext(ctx, "sudo", "-n", "docker", "ps", "-a",
		"--format", "{{.Names}}").CombinedOutput()
	if err == nil {
		for _, name := range strings.Fields(string(out)) {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			for _, p := range m.containerHostPorts(ctx, name) {
				if p < portStart || p > portEnd {
					continue
				}
				if _, ok := used[p]; ok {
					continue
				}
				used[p] = PortUse{Port: p, Source: "docker", Label: name}
			}
		}
	}
	return used
}

func (m *Manager) portBindable(port int) bool {
	if port <= 0 {
		return false
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func (m *Manager) pickPort(reg registry) (int, error) {
	used := m.usedPorts(reg)
	for p := portStart; p <= portEnd; p++ {
		if _, taken := used[p]; taken {
			continue
		}
		if !m.portBindable(p) {
			continue
		}
		return p, nil
	}
	return 0, fmt.Errorf("no free port in %d-%d", portStart, portEnd)
}

// AuditPorts returns used ports in the app range and the next free port.
func (m *Manager) AuditPorts(ctx context.Context) (PortAudit, error) {
	out := PortAudit{Start: portStart, End: portEnd, Used: []PortUse{}}
	if m == nil {
		return out, fmt.Errorf("deploy manager not configured")
	}
	_ = ctx
	m.mu.Lock()
	reg, err := m.loadRegistry()
	m.mu.Unlock()
	if err != nil {
		return out, err
	}
	used := m.usedPorts(reg)
	for p := portStart; p <= portEnd; p++ {
		if _, ok := used[p]; ok {
			continue
		}
		if !m.portBindable(p) {
			used[p] = PortUse{Port: p, Source: "listen", Label: "in use on host"}
		}
	}
	ports := make([]int, 0, len(used))
	for p := range used {
		ports = append(ports, p)
	}
	sort.Ints(ports)
	for _, p := range ports {
		out.Used = append(out.Used, used[p])
	}
	next, err := m.pickPort(reg)
	if err != nil {
		out.Next = 0
		out.Free = 0
		return out, nil
	}
	out.Next = next
	out.Free = (portEnd - portStart + 1) - len(used)
	if out.Free < 0 {
		out.Free = 0
	}
	return out, nil
}

func (m *Manager) cloneOrPull(ctx context.Context, repoDir, repo, branch, token string) error {
	publicURL := "https://github.com/" + repo + ".git"
	// Fine-grained PATs fail with Authorization: Bearer for git HTTPS;
	// GitHub expects Basic with username x-access-token.
	authHeader := "AUTHORIZATION: basic " + base64.StdEncoding.EncodeToString([]byte("x-access-token:"+token))
	env := append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_ASKPASS=/bin/echo",
		"GH_TOKEN="+token,
	)
	run := func(label string, args ...string) error {
		m.logf("cmd", "$ git %s", label)
		cmd := exec.CommandContext(ctx, "git", args...)
		cmd.Env = append(env, "GIT_CONFIG_COUNT=1",
			"GIT_CONFIG_KEY_0=http.https://github.com/.extraheader",
			"GIT_CONFIG_VALUE_0="+authHeader,
		)
		out, err := cmd.CombinedOutput()
		msg := strings.TrimSpace(string(out))
		msg = strings.ReplaceAll(msg, token, "***")
		if msg != "" {
			for _, line := range strings.Split(msg, "\n") {
				if strings.TrimSpace(line) == "" {
					continue
				}
				m.logf("out", "%s", line)
			}
		}
		if err != nil {
			m.logf("err", "git failed: %s", msg)
			return fmt.Errorf("git: %s", msg)
		}
		return nil
	}
	if _, err := os.Stat(filepath.Join(repoDir, ".git")); err == nil {
		m.logf("info", "Updating existing clone")
		_ = run("remote set-url", "-C", repoDir, "remote", "set-url", "origin", publicURL)
		if err := run("fetch", "-C", repoDir, "fetch", "origin", branch); err != nil {
			return err
		}
		if err := run("checkout", "-C", repoDir, "checkout", branch); err != nil {
			return err
		}
		if err := run("reset --hard", "-C", repoDir, "reset", "--hard", "origin/"+branch); err != nil {
			return err
		}
		m.logf("ok", "Clone updated · %s on disk", fmtBytes(dirSize(repoDir)))
		return nil
	}
	m.logf("info", "Fresh shallow clone")
	_ = os.RemoveAll(repoDir)
	if err := run("clone", "clone", "--branch", branch, "--single-branch", "--depth", "1", publicURL, repoDir); err != nil {
		return err
	}
	m.logf("ok", "Clone on disk · %s", fmtBytes(dirSize(repoDir)))
	return nil
}

func readManifestJSON(repoDir string) (Manifest, error) {
	b, err := os.ReadFile(filepath.Join(repoDir, "firewifi.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return Manifest{}, nil
		}
		return Manifest{}, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return Manifest{}, fmt.Errorf("firewifi.json: %w", err)
	}
	return m, nil
}
