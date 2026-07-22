package runner

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"time"
)

const scriptTimeout = 2 * time.Minute

// Runner executes hotspot bin/ scripts via sudo.
type Runner struct {
	BaseDir string
}

func New(baseDir string) *Runner {
	return &Runner{BaseDir: baseDir}
}

func (r *Runner) SwitchMode(ctx context.Context, mode string) error {
	return r.run(ctx, "mode", mode)
}

func (r *Runner) Start(ctx context.Context) error   { return r.run(ctx, "start") }
func (r *Runner) Stop(ctx context.Context) error    { return r.run(ctx, "stop") }
func (r *Runner) Restart(ctx context.Context) error { return r.run(ctx, "restart") }

func (r *Runner) run(ctx context.Context, script string, args ...string) error {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, scriptTimeout)
		defer cancel()
	}
	cmdArgs := append([]string{filepath.Join(r.BaseDir, "bin", script)}, args...)
	cmd := exec.CommandContext(ctx, "sudo", cmdArgs...)
	cmd.Dir = r.BaseDir
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("bin/%s failed: %w\n%s", script, err, out.String())
	}
	return nil
}
