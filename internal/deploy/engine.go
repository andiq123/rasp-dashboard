package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// VersionOption is one selectable runtime tag shown in the UI.
type VersionOption struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Image   string `json:"image,omitempty"`
	Hint    string `json:"hint,omitempty"`
	Current bool   `json:"current,omitempty"`
}

// EngineSettings persists shared Postgres + Go toolchain choices.
type EngineSettings struct {
	PostgresVersion string `json:"postgres_version"` // latest | 17 | 16 | 15
	GoToolchain     string `json:"go_toolchain"`     // auto | latest | 1.22 | …
	UpdatedAt       string `json:"updated_at,omitempty"`
}

// EngineView is the API payload for runtime management.
type EngineView struct {
	Settings         EngineSettings  `json:"settings"`
	PostgresOptions  []VersionOption `json:"postgres_options"`
	GoOptions        []VersionOption `json:"go_options"`
	PostgresImage    string          `json:"postgres_image"`
	PostgresRunning  bool            `json:"postgres_running"`
	GoResolvedHint   string          `json:"go_resolved_hint"`
}

func (m *Manager) enginePath() string {
	return filepath.Join(m.DeployDir, "engine.json")
}

func defaultEngine() EngineSettings {
	return EngineSettings{
		PostgresVersion: "16",
		GoToolchain:     "auto",
	}
}

func (m *Manager) LoadEngine() EngineSettings {
	b, err := os.ReadFile(m.enginePath())
	if err != nil {
		return defaultEngine()
	}
	var s EngineSettings
	if json.Unmarshal(b, &s) != nil {
		return defaultEngine()
	}
	if s.PostgresVersion == "" {
		s.PostgresVersion = "16"
	}
	if s.GoToolchain == "" {
		s.GoToolchain = "auto"
	}
	return s
}

func (m *Manager) saveEngine(s EngineSettings) error {
	if err := os.MkdirAll(m.DeployDir, 0o755); err != nil {
		return err
	}
	s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.enginePath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, m.enginePath())
}

func postgresCatalog() []VersionOption {
	return []VersionOption{
		// Pin "latest" to 16 — floating postgres:alpine jumped to 18+ and breaks existing volumes.
		{ID: "latest", Label: "Latest", Image: "postgres:16-alpine", Hint: "Stable 16 Alpine (recommended)"},
		{ID: "17", Label: "17", Image: "postgres:17-alpine", Hint: "Postgres 17"},
		{ID: "16", Label: "16", Image: "postgres:16-alpine", Hint: "LTS-friendly"},
		{ID: "15", Label: "15", Image: "postgres:15-alpine", Hint: "Previous major"},
	}
}

func goCatalog() []VersionOption {
	return []VersionOption{
		{ID: "auto", Label: "From go.mod", Hint: "Uses the module’s required Go version"},
		{ID: "latest", Label: "Latest", Image: "golang:bookworm", Hint: "Newest stable Go on bookworm"},
		{ID: "1.26", Label: "1.26", Image: "golang:1.26-bookworm"},
		{ID: "1.25", Label: "1.25", Image: "golang:1.25-bookworm"},
		{ID: "1.24", Label: "1.24", Image: "golang:1.24-bookworm"},
		{ID: "1.23", Label: "1.23", Image: "golang:1.23-bookworm"},
		{ID: "1.22", Label: "1.22", Image: "golang:1.22-bookworm"},
	}
}

func postgresImageFor(id string) string {
	id = strings.TrimSpace(strings.ToLower(id))
	for _, o := range postgresCatalog() {
		if o.ID == id {
			return o.Image
		}
	}
	// Allow raw docker tags like postgres:17 or 17-alpine
	if strings.HasPrefix(id, "postgres:") {
		return id
	}
	if matched, _ := regexp.MatchString(`^\d+$`, id); matched {
		return "postgres:" + id + "-alpine"
	}
	return "postgres:16-alpine"
}

func goImageForChoice(choice, goModVer string) (image, note string) {
	choice = strings.TrimSpace(strings.ToLower(choice))
	if choice == "" || choice == "auto" {
		img := golangImageFor(goModVer)
		if goModVer != "" {
			return img, "go.mod → " + goModVer
		}
		return img, "default toolchain"
	}
	if choice == "latest" {
		img := "golang:bookworm"
		// Still satisfy go.mod if it needs a brand-new minor not yet on :bookworm cache —
		// prefer explicit mod image when newer than a conservative floor.
		modImg := golangImageFor(goModVer)
		if goModNeedsNewerThanBookwormLatest(goModVer) {
			return modImg, "go.mod " + goModVer + " (pinned above latest tag)"
		}
		return img, "latest stable (bookworm)"
	}
	// Explicit version like 1.26
	if matched, _ := regexp.MatchString(`^\d+\.\d+$`, choice); matched {
		img := "golang:" + choice + "-bookworm"
		if goModVer != "" && goVersionLess(choice, goModVer) {
			// Selected toolchain too old for module — bump.
			return golangImageFor(goModVer), "bumped to go.mod " + goModVer + " (selected " + choice + " too old)"
		}
		return img, "pinned " + choice
	}
	if strings.HasPrefix(choice, "golang:") {
		return choice, "custom image"
	}
	return golangImageFor(goModVer), "fallback"
}

func goModNeedsNewerThanBookwormLatest(goModVer string) bool {
	// :bookworm tracks current stable; if go.mod asks for something absurdly new, use explicit tag.
	// Heuristic: if mod minor >= 27, prefer explicit golangImageFor.
	_, minor := parseGoMajorMinor(goModVer)
	return minor >= 27
}

func parseGoMajorMinor(ver string) (major, minor int) {
	major, minor = 1, 22
	ver = strings.TrimSpace(ver)
	if ver == "" {
		return
	}
	parts := strings.SplitN(ver, ".", 3)
	if len(parts) >= 1 {
		major, _ = strconv.Atoi(parts[0])
	}
	if len(parts) >= 2 {
		minor, _ = strconv.Atoi(parts[1])
	}
	return
}

func goVersionLess(a, b string) bool {
	am, ai := parseGoMajorMinor(a)
	bm, bi := parseGoMajorMinor(b)
	if am != bm {
		return am < bm
	}
	return ai < bi
}

// EngineView builds options + current selection for the UI.
func (m *Manager) EngineView(ctx context.Context) EngineView {
	s := m.LoadEngine()
	pgOpts := postgresCatalog()
	for i := range pgOpts {
		pgOpts[i].Current = pgOpts[i].ID == s.PostgresVersion
	}
	goOpts := goCatalog()
	for i := range goOpts {
		goOpts[i].Current = goOpts[i].ID == s.GoToolchain
	}
	img, hint := goImageForChoice(s.GoToolchain, "")
	_ = img
	v := EngineView{
		Settings:        s,
		PostgresOptions: pgOpts,
		GoOptions:       goOpts,
		PostgresImage:   postgresImageFor(s.PostgresVersion),
		GoResolvedHint:  hint,
	}
	if m.Postgres != nil {
		st := m.Postgres.Status(ctx)
		v.PostgresRunning = st.Running
		if st.Image != "" {
			v.PostgresImage = st.Image
		}
	}
	return v
}

// UpdateEngine persists runtime choices and applies Postgres image when needed.
func (m *Manager) UpdateEngine(ctx context.Context, in EngineSettings) (EngineView, error) {
	cur := m.LoadEngine()
	next := cur
	if v := strings.TrimSpace(in.PostgresVersion); v != "" {
		if !validPostgresVersion(v) {
			return EngineView{}, fmt.Errorf("unsupported postgres version %q", v)
		}
		next.PostgresVersion = v
	}
	if v := strings.TrimSpace(in.GoToolchain); v != "" {
		if !validGoToolchain(v) {
			return EngineView{}, fmt.Errorf("unsupported go toolchain %q", v)
		}
		next.GoToolchain = v
	}
	pgChanged := next.PostgresVersion != cur.PostgresVersion
	if err := m.saveEngine(next); err != nil {
		return EngineView{}, err
	}
	if pgChanged {
		img := postgresImageFor(next.PostgresVersion)
		m.logf("step", "Postgres engine → %s (%s)", next.PostgresVersion, img)
		if m.Postgres != nil {
			if err := m.Postgres.SetImage(ctx, img); err != nil {
				return m.EngineView(ctx), err
			}
			m.logf("ok", "Postgres image applied · %s", img)
		}
	} else {
		m.logf("ok", "Engine saved · postgres %s · go %s", next.PostgresVersion, next.GoToolchain)
	}
	return m.EngineView(ctx), nil
}

func validPostgresVersion(v string) bool {
	v = strings.ToLower(strings.TrimSpace(v))
	for _, o := range postgresCatalog() {
		if o.ID == v {
			return true
		}
	}
	ok, _ := regexp.MatchString(`^\d+$`, v)
	return ok
}

func validGoToolchain(v string) bool {
	v = strings.ToLower(strings.TrimSpace(v))
	for _, o := range goCatalog() {
		if o.ID == v {
			return true
		}
	}
	ok, _ := regexp.MatchString(`^\d+\.\d+$`, v)
	return ok || strings.HasPrefix(v, "golang:")
}

// ResolveGoImage returns the docker image for a build given optional per-deploy override.
func (m *Manager) ResolveGoImage(goModVer, override string) (image, note string) {
	choice := strings.TrimSpace(override)
	if choice == "" {
		choice = m.LoadEngine().GoToolchain
	}
	return goImageForChoice(choice, goModVer)
}


// StartPostgresEngine starts the shared compose Postgres with Activity logging.
func (m *Manager) StartPostgresEngine(ctx context.Context) (EngineView, error) {
	if m.Postgres == nil {
		return EngineView{}, fmt.Errorf("postgres engine not configured")
	}
	if err := m.acquireJob("Start Postgres engine", "engine/postgres"); err != nil {
		return EngineView{}, err
	}
	m.startProgress([]ProgressStep{
		{ID: "start", Label: "Start engine", Weight: 70, Status: "pending"},
		{ID: "ready", Label: "Wait for port", Weight: 30, Status: "pending"},
	})
	m.stepProgress("start")
	img := m.Postgres.Image()
	m.logf("info", "Image %s", img)
	m.logf("step", "docker compose up -d postgres")
	if err := m.Postgres.Start(ctx); err != nil {
		m.releaseJob(false, err.Error())
		return m.EngineView(ctx), err
	}
	m.stepProgress("ready")
	m.logf("ok", "Listening on 127.0.0.1:5432")
	m.releaseJob(true, "Postgres engine running")
	return m.EngineView(ctx), nil
}

// StopPostgresEngine stops the shared compose Postgres with Activity logging.
func (m *Manager) StopPostgresEngine(ctx context.Context) (EngineView, error) {
	if m.Postgres == nil {
		return EngineView{}, fmt.Errorf("postgres engine not configured")
	}
	if err := m.acquireJob("Stop Postgres engine", "engine/postgres"); err != nil {
		return EngineView{}, err
	}
	m.logf("step", "docker compose stop postgres")
	if err := m.Postgres.Stop(ctx); err != nil {
		m.releaseJob(false, err.Error())
		return m.EngineView(ctx), err
	}
	m.logf("ok", "Postgres engine stopped")
	m.releaseJob(true, "Postgres engine stopped")
	return m.EngineView(ctx), nil
}
