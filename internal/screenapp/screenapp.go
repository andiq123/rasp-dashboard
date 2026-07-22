package screenapp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Runner starts and stops a process in a detached `screen` session.
type Runner struct {
	BinaryPath string
	ScreenName string
	WorkingDir string
	// ExtraEnv are additional KEY=VALUE pairs injected when starting.
	ExtraEnv []string
}

// New builds a Runner driven by environment-variable overrides and defaults.
// envPrefix (e.g. "SYNCROX") controls: {PREFIX}_PATH, {PREFIX}_SCREEN_NAME, {PREFIX}_WORKING_DIR.
// extraEnv are KEY=VALUE pairs injected into the process environment on Start.
func New(envPrefix, defaultBin, defaultScreen string, extraEnv ...string) *Runner {
	get := func(suffix, fallback string) string {
		if v := os.Getenv(envPrefix + "_" + suffix); v != "" {
			return v
		}
		return fallback
	}
	dir := get("WORKING_DIR", "/home/andiq/apps")
	bin := get("PATH", defaultBin)
	if !filepath.IsAbs(bin) {
		bin = filepath.Join(dir, bin)
	}
	return &Runner{
		BinaryPath: bin,
		ScreenName: get("SCREEN_NAME", defaultScreen),
		WorkingDir: dir,
		ExtraEnv:   extraEnv,
	}
}

// isRunning returns true if a screen session with this name already exists.
func (r *Runner) isRunning() bool {
	out, _ := exec.Command("screen", "-ls").Output()
	return strings.Contains(string(out), "."+r.ScreenName+"\t") ||
		strings.Contains(string(out), "."+r.ScreenName+" ")
}

// LogPath returns the path of the screen session log file.
func (r *Runner) LogPath() string {
	return "/tmp/fw-" + r.ScreenName + ".log"
}

func (r *Runner) Start(ctx context.Context) error {
	// Kill any existing session first — prevents duplicates.
	if r.isRunning() {
		_ = exec.CommandContext(ctx, "screen", "-S", r.ScreenName, "-X", "quit").Run()
	}

	// Truncate log file so each run starts fresh.
	_ = os.WriteFile(r.LogPath(), nil, 0644)

	cmd := exec.CommandContext(ctx, "screen", "-dmS", r.ScreenName, r.BinaryPath)
	cmd.Dir = r.WorkingDir
	if len(r.ExtraEnv) > 0 {
		cmd.Env = mergeEnv(os.Environ(), r.ExtraEnv)
	}
	out, err := cmd.CombinedOutput()
	if err != nil && len(out) > 0 {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}

	// Enable logging into the log file — screen -dmS is synchronous so the session is ready.
	exec.Command("screen", "-S", r.ScreenName, "-X", "logfile", r.LogPath()).Run()
	exec.Command("screen", "-S", r.ScreenName, "-X", "log", "on").Run()

	return err
}

func (r *Runner) Stop(ctx context.Context) error {
	out, err := exec.CommandContext(ctx, "screen", "-S", r.ScreenName, "-X", "quit").CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if strings.Contains(msg, "No screen session found") {
			return nil
		}
		if len(out) > 0 {
			return fmt.Errorf("%w: %s", err, msg)
		}
		return err
	}
	return nil
}

// mergeEnv returns a copy of base with overrides applied (last write wins per key).
func mergeEnv(base, overrides []string) []string {
	keys := make(map[string]struct{}, len(overrides))
	for _, e := range overrides {
		if idx := strings.IndexByte(e, '='); idx > 0 {
			keys[e[:idx]] = struct{}{}
		}
	}
	out := make([]string, 0, len(base)+len(overrides))
	for _, e := range base {
		if idx := strings.IndexByte(e, '='); idx > 0 {
			if _, blocked := keys[e[:idx]]; blocked {
				continue
			}
		}
		out = append(out, e)
	}
	return append(out, overrides...)
}
