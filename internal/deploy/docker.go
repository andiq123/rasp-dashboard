package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"firewifi/dashboard/internal/deploy/cache"
)

var (
	buildCmdDanger = regexp.MustCompile(`[;&|$\x60]|\$\(|\n|\r`)
	slugOK         = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)
)

func validSlug(s string) bool {
	return slugOK.MatchString(s)
}

func (m *Manager) docker(ctx context.Context, args ...string) (string, error) {
	return m.dockerOpts(ctx, false, false, args...)
}

func (m *Manager) dockerQuiet(ctx context.Context, args ...string) (string, error) {
	return m.dockerOpts(ctx, false, true, args...)
}

func (m *Manager) dockerLogged(ctx context.Context, verbose bool, args ...string) (string, error) {
	return m.dockerOpts(ctx, verbose, false, args...)
}

func (m *Manager) dockerOpts(ctx context.Context, verbose, quiet bool, args ...string) (string, error) {
	all := append([]string{"-n", "docker"}, args...)
	label := "docker " + summarizeDockerArgs(args)
	var out string
	var err error
	if verbose {
		out, err = m.runCmdLogged(ctx, label, "sudo", all...)
	} else {
		out, err = runCmd(ctx, "sudo", all...)
	}
	trimmed := strings.TrimSpace(out)
	if err != nil {
		if trimmed == "" {
			trimmed = err.Error()
		}
		if !verbose && !quiet {
			m.logf("err", "%s", trimmed)
		}
		return trimmed, fmt.Errorf("%s", trimmed)
	}
	return trimmed, nil
}

func summarizeDockerArgs(args []string) string {
	if len(args) == 0 {
		return ""
	}
	op := args[0]
	switch op {
	case "run":
		img := ""
		for i := len(args) - 1; i >= 0; i-- {
			a := args[i]
			if a == "bash" || a == "-lc" || strings.HasPrefix(a, "-") {
				continue
			}
			if strings.Contains(a, "/") || strings.Contains(a, ":") {
				img = a
				break
			}
		}
		for _, a := range args {
			if a == "-d" {
				if img != "" {
					return "run -d " + img
				}
				return "run -d"
			}
		}
		if img != "" {
			return "run " + img
		}
		return "run"
	case "rm", "inspect":
		if len(args) > 1 {
			return op + " " + args[len(args)-1]
		}
		return op
	default:
		return op
	}
}

func (m *Manager) stopContainer(ctx context.Context, name string) {
	_, _ = m.dockerQuiet(ctx, "rm", "-f", name)
}

func (m *Manager) writeRuntimeEnv(group, slug, body string) (string, error) {
	body, _ = materializeSecrets(normalizeEnv(body))
	body = m.resolveEnvRefs(group, body)
	path := filepath.Join(m.serviceDir(group, slug), "runtime.env")
	if err := os.WriteFile(path, []byte(normalizeEnv(body)), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func (m *Manager) mergedEnv(group, slug string) (string, error) {
	// Group env first, then service env (service wins). DATABASE_URL from a
	// linked Postgres in the same group is injected by runGoContainer.
	gBody, _ := os.ReadFile(filepath.Join(m.groupDir(group), "env"))
	sBody, _ := os.ReadFile(filepath.Join(m.serviceDir(group, slug), "env"))
	return mergeEnvFiles(string(gBody), string(sBody)), nil
}

// ensureServiceLayout creates the canonical on-disk shape for a service:
//   deployments/groups/<group>/<slug>/{env,meta.json,runtime.env,out/app,repo?/}
func (m *Manager) ensureServiceLayout(group, slug string) error {
	dir := m.serviceDir(group, slug)
	if err := os.MkdirAll(filepath.Join(dir, "out"), 0o755); err != nil {
		return err
	}
	envPath := filepath.Join(dir, "env")
	if _, err := os.Stat(envPath); os.IsNotExist(err) {
		if err := os.WriteFile(envPath, []byte(""), 0o600); err != nil {
			return err
		}
	}
	return nil
}

// removeGroupContainers force-removes runtime + build containers for a group.
// Prefers label filter; falls back to fw-<group>- / fw-build-<group>- name prefixes
// for containers created before labels existed.
func (m *Manager) removeGroupContainers(ctx context.Context, group string) {
	seen := map[string]bool{}
	add := func(name string) {
		name = strings.TrimSpace(name)
		name = strings.TrimPrefix(name, "/")
		if name == "" || seen[name] {
			return
		}
		seen[name] = true
		m.logf("info", "Removing leftover container %s", name)
		m.stopContainer(ctx, name)
	}

	if out, err := m.dockerQuiet(ctx, "ps", "-a",
		"--filter", "label="+labelGroup+"="+group,
		"--format", "{{.Names}}"); err == nil {
		for _, name := range strings.Split(out, "\n") {
			add(name)
		}
	}

	prefixRun := "fw-" + group + "-"
	prefixBuild := "fw-build-" + group + "-"
	if out, err := m.dockerQuiet(ctx, "ps", "-a", "--format", "{{.Names}}"); err == nil {
		for _, name := range strings.Split(out, "\n") {
			name = strings.TrimSpace(name)
			if strings.HasPrefix(name, prefixRun) || strings.HasPrefix(name, prefixBuild) {
				add(name)
			}
		}
	}
}

// removeServiceContainers removes runtime + build containers for one service.
func (m *Manager) removeServiceContainers(ctx context.Context, group, slug string) {
	seen := map[string]bool{}
	add := func(name string) {
		name = strings.TrimSpace(strings.TrimPrefix(name, "/"))
		if name == "" || seen[name] {
			return
		}
		seen[name] = true
		m.stopContainer(ctx, name)
	}
	add(containerName(group, slug))
	add(buildContainerName(group, slug))
	if out, err := m.dockerQuiet(ctx, "ps", "-a",
		"--filter", "label="+labelGroup+"="+group,
		"--filter", "label="+labelService+"="+slug,
		"--format", "{{.Names}}"); err == nil {
		for _, name := range strings.Split(out, "\n") {
			add(name)
		}
	}
}

type goAudit struct {
	Cmd       string
	Reason    string
	GoVersion string // major.minor from go.mod, e.g. "1.26"
	Image     string
}

var (
	goVersionLine = regexp.MustCompile(`(?m)^go\s+(\d+\.\d+)(?:\.\d+)?\s*$`)
	airBuildCmd   = regexp.MustCompile(`(?m)^(?:\s*)cmd\s*=\s*"([^"]+)"`)
	goPkgPath     = regexp.MustCompile(`(?:^|\s)(\./[A-Za-z0-9_./-]+|\.)(?:\s|$)`)
)

func detectCmd(repoDir string) string {
	return auditGoModule(repoDir).Cmd
}

func auditGoModule(repoDir string) goAudit {
	a := goAudit{
		GoVersion: parseGoModVersion(repoDir),
	}
	a.Image = golangImageFor(a.GoVersion)

	if cmd, reason := detectCmdFromAir(repoDir); cmd != "" {
		a.Cmd, a.Reason = cmd, reason
		return a
	}
	if cmd, reason := detectCmdCandidates(repoDir); cmd != "" {
		a.Cmd, a.Reason = cmd, reason
		return a
	}
	a.Reason = "no package main under ./cmd or repository root"
	return a
}

func parseGoModVersion(repoDir string) string {
	b, err := os.ReadFile(filepath.Join(repoDir, "go.mod"))
	if err != nil {
		return ""
	}
	m := goVersionLine.FindSubmatch(b)
	if len(m) < 2 {
		return ""
	}
	return string(m[1])
}

// golangImageFor picks a toolchain image that satisfies go.mod.
// Prefer bookworm tags; bump when the module needs a newer Go.
func golangImageFor(ver string) string {
	major, minor := 1, 22
	if ver != "" {
		parts := strings.SplitN(ver, ".", 2)
		if len(parts) == 2 {
			fmt.Sscanf(parts[0]+" "+parts[1], "%d %d", &major, &minor)
		}
	}
	// Keep a small allow-list of known tags; otherwise use major.minor.
	tag := fmt.Sprintf("%d.%d", major, minor)
	switch {
	case major > 1 || (major == 1 && minor >= 22):
		return "golang:" + tag + "-bookworm"
	default:
		return "golang:bookworm"
	}
}

func detectCmdFromAir(repoDir string) (string, string) {
	b, err := os.ReadFile(filepath.Join(repoDir, ".air.toml"))
	if err != nil {
		return "", ""
	}
	m := airBuildCmd.FindSubmatch(b)
	if len(m) < 2 {
		return "", ""
	}
	raw := string(m[1])
	// Prefer the last ./path-looking token in the air build command.
	matches := goPkgPath.FindAllStringSubmatch(raw, -1)
	if len(matches) == 0 {
		return "", ""
	}
	cand := strings.TrimSpace(matches[len(matches)-1][1])
	cand = normalizeCmdPath(cand)
	if cand == "" {
		return "", ""
	}
	if !cmdPathExists(repoDir, cand) {
		return "", ""
	}
	if !packageIsMain(repoDir, cand) {
		return "", ""
	}
	return cand, "from .air.toml build cmd"
}

func detectCmdCandidates(repoDir string) (string, string) {
	type cand struct {
		path  string
		score int
		why   string
	}
	var list []cand

	moduleLeaf := modulePathLeaf(repoDir)
	cmdDir := filepath.Join(repoDir, "cmd")
	if entries, err := os.ReadDir(cmdDir); err == nil {
		dirs := make([]string, 0, 8)
		hasMainGo := false
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() {
				dirs = append(dirs, name)
				continue
			}
			if strings.HasSuffix(name, ".go") && !strings.HasSuffix(name, "_test.go") {
				hasMainGo = true
			}
		}
		sort.Strings(dirs)
		for _, name := range dirs {
			path := "./cmd/" + name
			if !packageIsMain(repoDir, path) {
				continue
			}
			score := 10
			why := "cmd/" + name
			switch strings.ToLower(name) {
			case "server", "api", "app", "cmd", "web", "gateway", "service", "main":
				score += 20
			}
			if moduleLeaf != "" && strings.EqualFold(name, moduleLeaf) {
				score += 30
			}
			list = append(list, cand{path: path, score: score, why: why})
		}
		if hasMainGo && packageIsMain(repoDir, "./cmd") {
			list = append(list, cand{path: "./cmd", score: 40, why: "cmd/main.go layout"})
		}
	}

	if packageIsMain(repoDir, ".") {
		list = append(list, cand{path: ".", score: 5, why: "repository root"})
	}

	// Shallow scan of common alternate entry folders.
	for _, alt := range []string{"app", "apps", "server", "api", "cmd/server", "cmd/api"} {
		path := "./" + strings.TrimPrefix(alt, "./")
		if !cmdPathExists(repoDir, path) || !packageIsMain(repoDir, path) {
			continue
		}
		list = append(list, cand{path: path, score: 8, why: alt})
	}

	if len(list) == 0 {
		return "", ""
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].score != list[j].score {
			return list[i].score > list[j].score
		}
		return list[i].path < list[j].path
	})
	best := list[0]
	return best.path, best.why
}

func modulePathLeaf(repoDir string) string {
	b, err := os.ReadFile(filepath.Join(repoDir, "go.mod"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "module ") {
			continue
		}
		mod := strings.TrimSpace(strings.TrimPrefix(line, "module "))
		mod = strings.Trim(mod, `"`)
		if i := strings.LastIndex(mod, "/"); i >= 0 {
			mod = mod[i+1:]
		}
		return mod
	}
	return ""
}

func normalizeCmdPath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, "\\", "/")
	if p == "" {
		return ""
	}
	// air often points at a file: ./cmd/main.go → ./cmd
	if strings.HasSuffix(p, ".go") {
		p = strings.TrimSuffix(p, "/"+filepath.Base(p))
		if !strings.HasPrefix(p, ".") {
			// filepath.Base of "./cmd/main.go" on Linux is main.go;
			// TrimSuffix with "/main.go" works on slash form.
			p = strings.TrimSuffix(strings.ReplaceAll(p, "\\", "/"), "/"+filepath.Base(strings.ReplaceAll(p, "\\", "/")))
		}
		// Simpler: strip trailing file component.
		if i := strings.LastIndex(p, "/"); i >= 0 {
			// already stripped above incorrectly sometimes — recompute from original
		}
	}
	orig := strings.TrimSpace(strings.ReplaceAll(strings.TrimSpace(p), "\\", "/"))
	// Re-normalize from caller path properly:
	return normalizeGoPackagePath(orig)
}

func normalizeGoPackagePath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, "\\", "/")
	if p == "" {
		return ""
	}
	if strings.HasSuffix(p, ".go") {
		if i := strings.LastIndex(p, "/"); i >= 0 {
			p = p[:i]
		} else {
			p = "."
		}
	}
	p = strings.TrimSuffix(p, "/")
	if p == "" || p == "." {
		return "."
	}
	if !strings.HasPrefix(p, "./") {
		if strings.HasPrefix(p, "/") {
			return ""
		}
		p = "./" + p
	}
	if strings.Contains(p, "..") {
		return ""
	}
	return p
}

func cmdPathExists(repoDir, cmdPath string) bool {
	cmdPath = normalizeGoPackagePath(cmdPath)
	if cmdPath == "" {
		return false
	}
	var abs string
	if cmdPath == "." {
		abs = repoDir
	} else {
		abs = filepath.Join(repoDir, filepath.FromSlash(strings.TrimPrefix(cmdPath, "./")))
	}
	st, err := os.Stat(abs)
	return err == nil && st.IsDir()
}

func packageIsMain(repoDir, cmdPath string) bool {
	cmdPath = normalizeGoPackagePath(cmdPath)
	if cmdPath == "" {
		return false
	}
	var abs string
	if cmdPath == "." {
		abs = repoDir
	} else {
		abs = filepath.Join(repoDir, filepath.FromSlash(strings.TrimPrefix(cmdPath, "./")))
	}
	return hasGoMain(abs)
}

func hasGoMain(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		// Cheap package-clause check; ignore files that only mention "package main" in comments by requiring it near the top.
		head := string(b)
		if len(head) > 4000 {
			head = head[:4000]
		}
		for _, line := range strings.Split(head, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "//") || strings.HasPrefix(line, "/*") {
				continue
			}
			if line == "package main" || strings.HasPrefix(line, "package main ") {
				return true
			}
			if strings.HasPrefix(line, "package ") {
				return false
			}
		}
	}
	return false
}


func normalizeRootDir(root string) (string, error) {
	root = strings.TrimSpace(root)
	root = strings.ReplaceAll(root, "\\", "/")
	root = strings.TrimPrefix(root, "./")
	root = strings.Trim(root, "/")
	if root == "" || root == "." {
		return "", nil
	}
	parts := strings.Split(root, "/")
	clean := make([]string, 0, len(parts))
	for _, p := range parts {
		if p == "" || p == "." {
			continue
		}
		if p == ".." {
			return "", fmt.Errorf("invalid root directory")
		}
		for _, r := range p {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
				continue
			}
			return "", fmt.Errorf("invalid root directory character in %q", p)
		}
		clean = append(clean, p)
	}
	return strings.Join(clean, "/"), nil
}

func resolveRootDir(repoDir, root string) (string, string, error) {
	norm, err := normalizeRootDir(root)
	if err != nil {
		return "", "", err
	}
	if norm == "" {
		return repoDir, "", nil
	}
	abs := filepath.Join(repoDir, filepath.FromSlash(norm))
	rel, err := filepath.Rel(repoDir, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", fmt.Errorf("root directory escapes repository")
	}
	st, err := os.Stat(abs)
	if err != nil || !st.IsDir() {
		return "", "", fmt.Errorf("root directory not found: %s", norm)
	}
	return abs, norm, nil
}

func validateBuildCmd(cmd string) error {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return nil
	}
	if buildCmdDanger.MatchString(cmd) {
		return fmt.Errorf("build command rejects shell metacharacters (;|&$` newlines)")
	}
	if !strings.Contains(cmd, "go build") {
		return fmt.Errorf("build command must include go build")
	}
	if !strings.Contains(cmd, "/out/app") {
		return fmt.Errorf("build command must write binary to /out/app")
	}
	return nil
}

func (m *Manager) binaryPath(group, slug string) string {
	return filepath.Join(m.serviceDir(group, slug), "out", "app")
}

func fileSize(path string) int64 {
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Size()
}

// buildGo compiles the service binary inside a golang container.
func (m *Manager) buildGo(ctx context.Context, svc Service, repoDir, outDir string) error {
	audit := auditGoModule(repoDir)
	cmdPath := strings.TrimSpace(svc.Cmd)
	if cmdPath == "" {
		cmdPath = audit.Cmd
	}
	if cmdPath == "" {
		return fmt.Errorf("no go main package found (looked for ./cmd/*, ./cmd, ., .air.toml)")
	}
	if _, err := os.Stat(filepath.Join(repoDir, "go.mod")); err != nil {
		return fmt.Errorf("not a Go module (missing go.mod)")
	}

	buildCmd := strings.TrimSpace(svc.BuildCmd)
	if buildCmd == "" {
		buildCmd = defaultGoBuildCmd(cmdPath)
	} else {
		var err error
		buildCmd, err = productionizeBuildCmd(buildCmd)
		if err != nil {
			return err
		}
	}
	if err := validateBuildCmd(buildCmd); err != nil {
		return err
	}
	m.logf("info", "Production build (trimpath, stripped, CGO off)")

	if outDir == "" {
		outDir = filepath.Join(m.serviceDir(svc.Group, svc.Slug), "out")
	}
	_ = os.RemoveAll(outDir)
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}

	image, goNote := m.ResolveGoImage(audit.GoVersion, svc.GoToolchain)
	if image == "" {
		image = "golang:bookworm"
	}
	if audit.Reason != "" {
		m.logf("info", "Entrypoint %s (%s)", cmdPath, audit.Reason)
	} else {
		m.logf("info", "Entrypoint %s", cmdPath)
	}
	m.logf("info", "Toolchain %s · %s", image, goNote)

	m.logf("step", "Building %s", cmdPath)
	m.logf("cmd", "$ %s", buildCmd)
	buildCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()

	if m.Cache == nil {
		m.Cache = cache.New(m.DeployDir)
	}
	// One-time migrate from legacy path if present.
	legacy := filepath.Join(m.DeployDir, ".gocache", "pkg")
	goLayer, err := m.Cache.OpenGoModules(svc.Group, svc.Slug, repoDir)
	if err != nil {
		return err
	}
	if !goLayer.Hit {
		if st, e := os.Stat(legacy); e == nil && st.IsDir() {
			_ = os.MkdirAll(filepath.Dir(goLayer.Path), 0o755)
			_ = os.Rename(legacy, goLayer.Path)
			goLayer.Hit = true
			m.logf("info", "Migrated legacy Go module cache")
		}
	}
	m.logf("info", "Cache %s", goLayer.Summary())

	vols, env := cache.GoDockerArgs(goLayer)

	run := func(label string, online bool, shell string, srcRO bool) error {
		m.logf("info", "%s", label)
		buildName := buildContainerName(svc.Group, svc.Slug)
		m.stopContainer(ctx, buildName)
		defer m.stopContainer(context.Background(), buildName)
		args := []string{"run", "--rm", "--name", buildName}
		args = append(args, dockerScopeLabels(svc.Group, svc.Slug, "build")...)
		// Match host UID so /out/app is not root-owned (chmod would fail on Pi).
		args = append(args, "--user", strconv.Itoa(os.Getuid())+":"+strconv.Itoa(os.Getgid()))
		if online {
			// Default bridge + public DNS. Host networking ignores --dns and
			// inherits hotspot/VPN resolv.conf (e.g. 192.168.100.1) which fails.
			args = append(args, "--dns", "8.8.8.8", "--dns", "1.1.1.1")
		} else {
			args = append(args, "--network", "none")
		}
		src := repoDir + ":/src"
		if srcRO {
			src += ":ro"
		}
		args = append(args, "-v", src, "-v", outDir+":/out")
		for _, v := range vols {
			args = append(args, "-v", v)
		}
		runEnv := append([]string{}, env...)
		runEnv = append(runEnv, "HOME=/tmp")
		if !online {
			runEnv = append(runEnv, "GOPROXY=off", "GOSUMDB=off")
		}
		for _, e := range runEnv {
			args = append(args, "-e", e)
		}
		args = append(args, "-w", "/src", image, "bash", "-c", shell)
		_, err := m.dockerLogged(buildCtx, true, args...)
		return err
	}

	compileOffline := "GOFLAGS=-mod=readonly " + buildCmd
	compileOnline := buildCmd

	m.stepProgress("modules")
	if cache.GoCanOffline(goLayer) {
		m.detailProgress("Using module cache")
		m.logf("ok", "Modules warm — offline compile")
		m.stepProgress("build")
		m.detailProgress("Compiling")
		err = run("Offline compile (cached modules)", false, compileOffline, true)
		if err != nil {
			m.logf("warn", "Offline compile incomplete — downloading modules")
			m.stepProgress("modules")
			m.detailProgress("Downloading modules")
			err = run("Download modules", true, "go mod download", false)
			if err != nil {
				return fmt.Errorf("modules: %w", err)
			}
			_ = m.Cache.Remember(svc.Group, svc.Slug, goLayer)
			m.stepProgress("build")
			m.detailProgress("Compiling")
			err = run("Compile (offline after download)", false, compileOffline, true)
			if err != nil {
				err = run("Compile (online)", true, compileOnline, false)
			}
		}
	} else {
		if goLayer.Changed {
			m.detailProgress("Refreshing modules")
			m.logf("info", "go.mod/go.sum changed — refreshing module layer")
		} else {
			m.detailProgress("Downloading modules")
			m.logf("info", "Go modules cache cold — downloading")
		}
		err = run("Download modules", true, "go mod download", false)
		if err != nil {
			return fmt.Errorf("modules: %w", err)
		}
		_ = m.Cache.Remember(svc.Group, svc.Slug, goLayer)
		m.stepProgress("build")
		m.detailProgress("Compiling")
		err = run("Compile (offline)", false, compileOffline, true)
		if err != nil {
			m.logf("warn", "Offline compile failed — retrying online")
			err = run("Compile (online)", true, compileOnline, false)
		}
	}
	if err != nil {
		return fmt.Errorf("build: %w", err)
	}
	_ = m.Cache.Remember(svc.Group, svc.Slug, goLayer)

	bin := filepath.Join(outDir, "app")
	if _, err := os.Stat(bin); err != nil {
		return fmt.Errorf("build produced no /out/app binary — check build command")
	}
	if err := ensureExecutable(bin); err != nil {
		return fmt.Errorf("binary permissions: %w", err)
	}
	m.logf("ok", "Binary ready · %s", fmtBytes(fileSize(bin)))
	return nil
}


// cgroupMemorySupported reports whether Docker can enforce --memory on this host.
// Raspberry Pi images often run cgroup v2 without the memory controller enabled.
func cgroupMemorySupported() bool {
	b, err := os.ReadFile("/sys/fs/cgroup/cgroup.controllers")
	if err != nil {
		return false
	}
	for _, f := range strings.Fields(string(b)) {
		if f == "memory" {
			return true
		}
	}
	return false
}

// runGoContainer starts (or replaces) the runtime container from an existing binary.
func (m *Manager) runGoContainer(ctx context.Context, svc Service) error {
	name := containerName(svc.Group, svc.Slug)
	mem, cpus := clampResources(svc.MemoryMB, svc.CPUs)
	bin := m.binaryPath(svc.Group, svc.Slug)
	if _, err := os.Stat(bin); err != nil {
		return fmt.Errorf("binary missing — redeploy first")
	}

	m.stepProgress("start")
	m.logf("step", "Starting container %s on :%d", name, svc.Port)
	merged, err := m.mergedEnv(svc.Group, svc.Slug)
	if err != nil {
		return err
	}
	merged = upsertEnv(merged, "PORT", fmt.Sprintf("%d", svc.Port))
	beforeProd := merged
	var secNew bool
	merged, secNew = m.ensureBootstrapSecrets(svc.Group, svc.Slug, merged, true)
	if secNew {
		m.logf("info", "Bootstrapped auth secrets (persisted)")
	}
	if overs := productionEnvOverrides(beforeProd, merged); len(overs) > 0 {
		m.logf("warn", "Forced production env: %s", strings.Join(overs, ", "))
	} else {
		m.logf("info", "Runtime mode production (APP_ENV/GIN_MODE/NODE_ENV)")
	}
	if svc.LinkedDatabase != "" {
		before := merged
		merged = m.injectLinkedDatabase(merged, svc.Group, svc.LinkedDatabase)
		if strings.TrimSpace(parseEnvMap(merged)["DATABASE_URL"]) != "" {
			m.logf("info", "Copied DB env from %s · group-scoped", svc.LinkedDatabase)
		} else if before == merged {
			m.logf("warn", "Linked database %s has no connection env", svc.LinkedDatabase)
		} else {
			m.logf("warn", "Linked database %s missing DATABASE_URL", svc.LinkedDatabase)
		}
	}
	if svc.LinkedBucket != "" {
		beforeB := merged
		merged = m.injectLinkedBucket(merged, svc.Group, svc.LinkedBucket)
		if strings.TrimSpace(parseEnvMap(merged)["BUCKET"]) != "" {
			m.logf("info", "Copied bucket env from %s · group-scoped", svc.LinkedBucket)
		} else if beforeB == merged {
			m.logf("warn", "Linked bucket %s has no connection env", svc.LinkedBucket)
		} else {
			m.logf("warn", "Linked bucket %s missing BUCKET", svc.LinkedBucket)
		}
	}
	envMap := parseEnvMap(merged)
	if strings.TrimSpace(envMap["DATABASE_URL"]) == "" && strings.TrimSpace(envMap["DB_HOST"]) == "" {
		m.logf("warn", "No database env — apps that need Postgres will crash on boot")
	}
	envPath, err := m.writeRuntimeEnv(svc.Group, svc.Slug, merged)
	if err != nil {
		return err
	}

	m.logf("info", "Replacing any previous container")
	m.removeServiceContainers(ctx, svc.Group, svc.Slug)
	// Host network: app shares the Pi network stack so loopback Postgres
	// (127.0.0.1:5432) and published ports work without bridge NAT.
	runArgs := []string{
		"run", "-d",
		"--name", name,
		"--network", "host",
		"--restart", "unless-stopped",
	}
	if cgroupMemorySupported() {
		runArgs = append(runArgs, "--memory", fmt.Sprintf("%dm", mem))
		m.logf("info", "Memory limit %d MB · CPU %s", mem, formatCPUs(cpus))
	} else {
		m.logf("info", "CPU %s · memory limit skipped (kernel has no cgroup memory controller)", formatCPUs(cpus))
	}
	runArgs = append(runArgs,
		"--cpus", formatCPUs(cpus),
		"--env-file", envPath,
		"-v", bin+":/app:ro",
		"--entrypoint", "/app",
	)
	runArgs = append(runArgs, dockerScopeLabels(svc.Group, svc.Slug, "runtime")...)
	runArgs = append(runArgs, "alpine:3.20")
	_, err = m.dockerLogged(ctx, true, runArgs...)
	if err != nil {
		return fmt.Errorf("run: %w", err)
	}
	m.stepProgress("health")
	m.logf("step", "Health check on :%d (stable process + port)", svc.Port)
	if err := m.waitContainerHealthy(ctx, name, svc.Port); err != nil {
		logs, _ := m.TailContainerLogs(ctx, svc.Group, svc.Slug, 100)
		m.logAppOutput("App crash output", logs)
		summary := summarizeCrash(logs)
		return fmt.Errorf("start failed: %s", summary)
	}
	m.logf("ok", "Container healthy")
	m.logf("ok", "Listening on http://rasp.local:%d", svc.Port)
	return nil
}

func (m *Manager) waitContainerHealthy(ctx context.Context, name string, port int) error {
	deadline := time.Now().Add(12 * time.Second)
	sawRunning := false
	stableSince := time.Time{}
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		st := m.inspectContainer(ctx, name)
		if st.Status == "missing" {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		if st.Restarting || st.Status == "exited" || st.Status == "dead" {
			return fmt.Errorf("container %s (exit %d)", st.Status, st.ExitCode)
		}
		if st.Running && st.Status == "running" {
			sawRunning = true
			portOK := port <= 0 || m.portOpen(port)
			if portOK {
				if stableSince.IsZero() {
					stableSince = time.Now()
				}
				// Require a short stable window so panic-after-listen is caught.
				if time.Since(stableSince) >= 1500*time.Millisecond {
					// Re-check once more — crash loops flip to restarting quickly.
					time.Sleep(400 * time.Millisecond)
					st2 := m.inspectContainer(ctx, name)
					if st2.Restarting || !st2.Running || st2.Status != "running" {
						return fmt.Errorf("container crashed after start (%s)", st2.Status)
					}
					if port > 0 && !m.portOpen(port) {
						return fmt.Errorf("port :%d closed after start", port)
					}
					return nil
				}
			} else {
				stableSince = time.Time{}
				m.logf("info", "Process up — waiting for :%d", port)
			}
		} else {
			stableSince = time.Time{}
		}
		time.Sleep(250 * time.Millisecond)
	}
	if sawRunning {
		st := m.inspectContainer(ctx, name)
		return fmt.Errorf("not healthy in time (status=%s restarting=%v port_open=%v)", st.Status, st.Restarting, m.portOpen(port))
	}
	return fmt.Errorf("container never became ready")
}

func (m *Manager) buildAndRunGo(ctx context.Context, svc Service, repoDir, deployID string) error {
	outDir := filepath.Join(m.serviceDir(svc.Group, svc.Slug), "out")
	if deployID != "" {
		outDir = m.stagingDir(svc.Group, svc.Slug, deployID)
	}
	if err := m.buildGo(ctx, svc, repoDir, outDir); err != nil {
		return err
	}
	if deployID != "" {
		m.stepProgress("promote")
		m.logf("step", "Promote %s → live", deployID)
		if err := m.promoteBinary(svc.Group, svc.Slug, deployID); err != nil {
			return fmt.Errorf("promote: %w", err)
		}
		if err := m.PromoteDeployment(svc.Group, svc.Slug, deployID); err != nil {
			m.logf("warn", "Promote metadata: %v", err)
		} else {
			m.logf("ok", "Active · %s (previous archived)", deployID)
		}
		_ = os.RemoveAll(m.stagingDir(svc.Group, svc.Slug, deployID))
	} else {
		m.skipProgress("promote")
	}
	clonePath := filepath.Join(m.serviceDir(svc.Group, svc.Slug), "repo")
	m.stepProgress("purge")
	m.logf("info", "Purging source clone (%s)", fmtBytes(dirSize(clonePath)))
	_ = os.RemoveAll(clonePath)
	if err := m.runGoContainer(ctx, svc); err != nil {
		return fmt.Errorf("start: %w", err)
	}
	return nil
}

func (m *Manager) purgeServiceFiles(group, slug string) {
	_ = os.RemoveAll(m.serviceDir(group, slug))
}

// recreateGo restarts the container with new env/resources without rebuilding.
func (m *Manager) recreateGo(ctx context.Context, svc Service) error {
	m.logf("step", "Restarting %s/%s (env & limits · no rebuild)", svc.Group, svc.Slug)
	if err := m.runGoContainer(ctx, svc); err != nil {
		return err
	}
	m.logf("ok", "Container restarted with current env")
	return nil
}

func (m *Manager) readServiceDATABASEURL(group, slug string) string {
	b, err := os.ReadFile(filepath.Join(m.serviceDir(group, slug), "env"))
	if err != nil {
		return ""
	}
	return parseEnvMap(string(b))["DATABASE_URL"]
}

func (m *Manager) readServiceBUCKETURL(group, slug string) string {
	b, err := os.ReadFile(filepath.Join(m.serviceDir(group, slug), "env"))
	if err != nil {
		return ""
	}
	return bucketURLFromEnvMap(parseEnvMap(string(b)))
}
