package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"firewifi/dashboard/internal/deploy/cache"
)

// Rust services share the Go pipeline (clone → build → /out/app → Alpine runtime).
// Only the compile step differs: a Cargo project is built in an Alpine Rust
// container, where the default target is musl and the binary is fully static.

const (
	// RuntimeRust marks a service whose source is a Cargo project.
	RuntimeRust = "rust"

	rustBuildImage = "rust:alpine"
	// A cold release build of a typical web service takes 20–40 minutes on a Pi 4.
	rustBuildTimeout = 75 * time.Minute
	goDeployTimeout  = 25 * time.Minute
)

var (
	cargoSection = regexp.MustCompile(`^\s*\[+\s*([A-Za-z0-9_.-]+)\s*\]+`)
	cargoName    = regexp.MustCompile(`^\s*name\s*=\s*"([^"]+)"`)
	cargoBinName = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

// isRustProject reports a Cargo project. A directory that also has go.mod stays Go.
func isRustProject(dir string) bool {
	if dir == "" || cache.DetectGo(dir) {
		return false
	}
	st, err := os.Stat(filepath.Join(dir, "Cargo.toml"))
	return err == nil && !st.IsDir()
}

// serviceRuntime labels what a build directory compiles with ("" for Go).
func serviceRuntime(buildDir string) string {
	if isRustProject(buildDir) {
		return RuntimeRust
	}
	return ""
}

// deployTimeout bounds one whole deploy of the service built from buildDir.
func deployTimeout(buildDir string) time.Duration {
	if isRustProject(buildDir) {
		return rustBuildTimeout + 5*time.Minute
	}
	return goDeployTimeout
}

// rustBinaryName reads the binary Cargo builds: the first [[bin]] target's name,
// otherwise the package name.
func rustBinaryName(dir string) (string, error) {
	b, err := os.ReadFile(filepath.Join(dir, "Cargo.toml"))
	if err != nil {
		return "", fmt.Errorf("not a Cargo project (missing Cargo.toml)")
	}
	var pkg, bin string
	section := ""
	for _, line := range strings.Split(string(b), "\n") {
		if m := cargoSection.FindStringSubmatch(line); m != nil {
			section = m[1]
			continue
		}
		m := cargoName.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		switch {
		case section == "package" && pkg == "":
			pkg = m[1]
		case section == "bin" && bin == "":
			bin = m[1]
		}
	}
	name := bin
	if name == "" {
		name = pkg
	}
	if name == "" {
		return "", fmt.Errorf("Cargo.toml has no [package] — point the root directory at the crate to deploy")
	}
	if !cargoBinName.MatchString(name) {
		return "", fmt.Errorf("unsupported binary name %q in Cargo.toml", name)
	}
	return name, nil
}

// suggestLocalRustRoot finds the crate to build when the repository root has none.
func suggestLocalRustRoot(repoDir string) string {
	for _, pref := range preferredGoRoots {
		if isRustProject(filepath.Join(repoDir, pref)) {
			if _, err := rustBinaryName(filepath.Join(repoDir, pref)); err == nil {
				return pref
			}
		}
	}
	return ""
}

func rustBuildJobs() int {
	// Leave one core for the services that keep running during a build.
	if n := runtime.NumCPU() - 1; n > 1 {
		return n
	}
	return 1
}

// buildRust compiles the service binary inside a Rust container into outDir/app.
func (m *Manager) buildRust(ctx context.Context, svc Service, buildDir, outDir string) error {
	bin, err := rustBinaryName(buildDir)
	if err != nil {
		return err
	}
	if strings.TrimSpace(svc.BuildCmd) != "" {
		m.logf("warn", "Custom build command ignored — Rust services always run cargo build --release")
	}
	if outDir == "" {
		outDir = filepath.Join(m.serviceDir(svc.Group, svc.Slug), "out")
	}
	_ = os.RemoveAll(outDir)
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}

	// Registry and git checkouts are shared; compiled artifacts are per service,
	// so a redeploy only recompiles what changed.
	if m.Cache == nil {
		m.Cache = cache.New(m.DeployDir)
	}
	cargoHome := m.Cache.CargoHome()
	targetDir := m.Cache.CargoTarget(svc.Group, svc.Slug)
	for _, dir := range []string{cargoHome, targetDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	_ = cache.EnsureWritable(cargoHome, targetDir)
	warm := dirSize(targetDir) > 0

	locked := ""
	if _, err := os.Stat(filepath.Join(buildDir, "Cargo.lock")); err == nil {
		locked = " --locked"
	} else {
		m.logf("warn", "No Cargo.lock committed — dependency versions are resolved at build time")
	}
	// The target is named explicitly: on a musl host, sharing one artifact
	// directory between proc-macros and the binary fails to link.
	shell := `set -e; T=$(rustc -vV | sed -n 's/^host: //p'); rustc --version; ` +
		`cargo build --release` + locked + ` --target "$T" --bin ` + bin + `; ` +
		`cp "/target/$T/release/` + bin + `" /out/app`

	m.logf("info", "Entrypoint %s (Cargo binary)", bin)
	m.logf("info", "Toolchain %s · static musl build", rustBuildImage)
	if warm {
		m.logf("info", "Cache warm — only changed crates recompile")
	} else {
		m.logf("info", "Cache cold — first build compiles every dependency (can take 20–40 min on a Pi)")
	}
	m.skipProgress("modules")
	m.stepProgress("build")
	m.detailProgress("Compiling")
	m.logf("step", "Building %s", bin)
	m.logf("cmd", "$ cargo build --release%s --bin %s", locked, bin)

	buildCtx, cancel := context.WithTimeout(ctx, rustBuildTimeout)
	defer cancel()
	// Mount the whole clone so workspace members and path dependencies resolve.
	srcDir, workDir := buildDir, "/src"
	repoDir := filepath.Join(m.serviceDir(svc.Group, svc.Slug), "repo")
	if rel, err := filepath.Rel(repoDir, buildDir); err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
		srcDir, workDir = repoDir, "/src/"+filepath.ToSlash(rel)
	}
	buildName := buildContainerName(svc.Group, svc.Slug)
	m.stopContainer(ctx, buildName)
	defer m.stopContainer(context.Background(), buildName)
	defer m.stopBuildContainerOnDone(buildCtx, buildName)()

	args := []string{"run", "--rm", "--name", buildName}
	args = append(args, dockerScopeLabels(svc.Group, svc.Slug, "build")...)
	args = append(args,
		// Match host UID so /out/app and the caches are not root-owned.
		"--user", strconv.Itoa(os.Getuid())+":"+strconv.Itoa(os.Getgid()),
		// Public DNS: the hotspot/VPN resolver is not reachable from the bridge.
		"--dns", "8.8.8.8", "--dns", "1.1.1.1",
		"-v", srcDir+":/src:ro",
		"-v", outDir+":/out",
		"-v", cargoHome+":/cargo",
		"-v", targetDir+":/target",
		"-e", "HOME=/tmp",
		"-e", "CARGO_HOME=/cargo",
		"-e", "CARGO_TARGET_DIR=/target",
		"-e", "CARGO_BUILD_JOBS="+strconv.Itoa(rustBuildJobs()),
		"-e", "CARGO_INCREMENTAL=0",
		"-e", "CARGO_TERM_COLOR=never",
		"-e", "CARGO_PROFILE_RELEASE_STRIP=symbols",
		"-w", workDir, rustBuildImage, "sh", "-c", shell,
	)
	if _, err := m.dockerLogged(buildCtx, true, args...); err != nil {
		if buildCtx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("build: timed out after %s — Redeploy resumes from the cached crates", rustBuildTimeout)
		}
		return fmt.Errorf("build: %w", err)
	}

	out := filepath.Join(outDir, "app")
	if _, err := os.Stat(out); err != nil {
		return fmt.Errorf("build produced no /out/app binary")
	}
	if err := ensureExecutable(out); err != nil {
		return fmt.Errorf("binary permissions: %w", err)
	}
	m.logf("ok", "Binary ready · %s", fmtBytes(fileSize(out)))
	return nil
}
