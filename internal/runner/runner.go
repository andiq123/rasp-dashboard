package runner

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
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
func (r *Runner) RepairVPN(ctx context.Context) error {
	return r.RepairVPNWithProgress(ctx, nil)
}

type VPNRepairProgress func(phase, message string)

func (r *Runner) RepairVPNWithProgress(ctx context.Context, report VPNRepairProgress) error {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, scriptTimeout)
		defer cancel()
	}
	reportVPNProgress(report, "preparing", "Checking the saved Romanian Mullvad relay")
	err := r.runProgress(ctx, report, "update-mullvad-relay", "--apply", "--restart")
	if !isMullvadEgressFailure(err) {
		if err == nil {
			reportVPNProgress(report, "verified", "Romanian Mullvad egress verified")
		}
		return err
	}

	// The host repair script already rotates when a peer cannot handshake. It
	// cannot distinguish a peer that handshakes but has dead egress, so retry
	// once while excluding that peer. The script still enforces Romania-only.
	key := mullvadPublicKey(filepath.Join(r.BaseDir, "config", "mullvad-wg.conf"))
	if key == "" {
		return err
	}
	log.Printf("Mullvad relay handshook without egress; retrying one alternate Romanian relay")
	reportVPNProgress(report, "rotating", "First relay had no internet; selecting one alternate Romanian relay")
	err = r.runEnvProgress(ctx, map[string]string{"MULLVAD_EXCLUDE_KEY": key}, report,
		"update-mullvad-relay", "--apply", "--restart")
	if err == nil {
		reportVPNProgress(report, "verified", "Alternate Romanian relay verified")
	}
	return err
}

func (r *Runner) run(ctx context.Context, script string, args ...string) error {
	return r.runEnv(ctx, nil, script, args...)
}

func (r *Runner) runProgress(ctx context.Context, report VPNRepairProgress, script string, args ...string) error {
	return r.runEnvProgress(ctx, nil, report, script, args...)
}

type scriptError struct {
	script string
	cause  error
	output string
}

func (e *scriptError) Error() string { return summarizeScriptFailure(e.script, e.cause, e.output) }
func (e *scriptError) Unwrap() error { return e.cause }

func (r *Runner) runEnv(ctx context.Context, env map[string]string, script string, args ...string) error {
	return r.runEnvProgress(ctx, env, nil, script, args...)
}

func (r *Runner) runEnvProgress(ctx context.Context, env map[string]string, report VPNRepairProgress, script string, args ...string) error {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, scriptTimeout)
		defer cancel()
	}
	cmdArgs := make([]string, 0, len(env)+len(args)+2)
	if len(env) > 0 {
		cmdArgs = append(cmdArgs, "env")
		for key, value := range env {
			cmdArgs = append(cmdArgs, key+"="+value)
		}
	}
	cmdArgs = append(cmdArgs, filepath.Join(r.BaseDir, "bin", script))
	cmdArgs = append(cmdArgs, args...)
	cmd := exec.CommandContext(ctx, "sudo", cmdArgs...)
	cmd.Dir = r.BaseDir
	out := &repairOutput{report: report}
	cmd.Stdout = out
	cmd.Stderr = out
	if err := cmd.Run(); err != nil {
		log.Printf("bin/%s failed: %v\n%s", script, err, out.String())
		cause := err
		if ctx.Err() != nil {
			cause = ctx.Err()
		}
		return &scriptError{script: script, cause: cause, output: out.String()}
	}
	return nil
}

type repairOutput struct {
	mu      sync.Mutex
	buf     bytes.Buffer
	pending string
	report  VPNRepairProgress
}

func (w *repairOutput) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n, err := w.buf.Write(p)
	w.pending += string(p)
	for {
		idx := strings.IndexByte(w.pending, '\n')
		if idx < 0 {
			break
		}
		line := strings.TrimSpace(w.pending[:idx])
		w.pending = w.pending[idx+1:]
		reportRepairLine(w.report, line)
	}
	return n, err
}

func (w *repairOutput) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.String()
}

func reportVPNProgress(report VPNRepairProgress, phase, message string) {
	if report != nil {
		report(phase, message)
	}
}

func reportRepairLine(report VPNRepairProgress, line string) {
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(lower, "downloading mullvad"):
		reportVPNProgress(report, "fetching", "Downloading the current Romanian relay list")
	case strings.Contains(lower, "updated mullvad relay"):
		reportVPNProgress(report, "selected", strings.TrimPrefix(line, "[+] "))
	case strings.Contains(lower, "relay is current"):
		reportVPNProgress(report, "selected", strings.TrimPrefix(line, "[+] "))
	case strings.Contains(lower, "restarting"):
		reportVPNProgress(report, "restarting", "Restarting WireGuard with the selected relay")
	case strings.Contains(lower, "did not handshake; rotating"):
		reportVPNProgress(report, "rotating", "Relay did not handshake; rotating within Romania")
	case strings.Contains(lower, "retrying") && strings.Contains(lower, "udp 53"):
		reportVPNProgress(report, "rotating", "Standard WireGuard port was blocked; retrying safely on UDP 53")
	case strings.Contains(lower, "you are connected to mullvad"):
		reportVPNProgress(report, "verified", strings.TrimPrefix(line, "[+] "))
	}
}

func isMullvadEgressFailure(err error) bool {
	var runErr *scriptError
	if err == nil || !errors.As(err, &runErr) {
		return false
	}
	out := strings.ToLower(runErr.output)
	return strings.Contains(out, "connection verification failed") ||
		strings.Contains(out, "egress verification failed")
}

func mullvadPublicKey(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 && strings.TrimSpace(parts[0]) == "PublicKey" {
			return strings.TrimSpace(parts[1])
		}
	}
	return ""
}

func summarizeScriptFailure(script string, cause error, output string) string {
	lower := strings.ToLower(output)
	switch {
	case strings.Contains(lower, "connection verification failed") || strings.Contains(lower, "egress verification failed"):
		return "The Mullvad relay connected but had no verified internet. Internet remains safely blocked; try Repair VPN again."
	case strings.Contains(lower, "did not handshake") || strings.Contains(lower, "no available relay"):
		return "No available Romanian Mullvad relay completed a WireGuard handshake. Internet remains safely blocked."
	case strings.Contains(lower, "could not download mullvad relay list"):
		return "Could not download the current Mullvad relay list through the Pi's upstream connection."
	case strings.Contains(lower, "could not resolve"):
		return "The Pi could not resolve Mullvad through its upstream DNS connection."
	case cause == context.DeadlineExceeded:
		return "The VPN repair timed out before it could verify a safe Romanian connection."
	default:
		return fmt.Sprintf("%s failed: %v", strings.ReplaceAll(script, "-", " "), cause)
	}
}
