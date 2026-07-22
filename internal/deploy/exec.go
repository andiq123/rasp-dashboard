package deploy

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

func runCmd(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// runCmdLogged streams combined stdout/stderr into the activity console line-by-line.
func (m *Manager) runCmdLogged(ctx context.Context, label string, name string, args ...string) (string, error) {
	if label != "" {
		m.logf("cmd", "$ %s", label)
	}
	cmd := exec.CommandContext(ctx, name, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}

	// Quiet commands (docker compile) need heartbeats so the UI does not look frozen.
	hbDone := make(chan struct{})
	go func() {
		t := time.NewTicker(8 * time.Second)
		defer t.Stop()
		elapsed := 0
		for {
			select {
			case <-hbDone:
				return
			case <-ctx.Done():
				return
			case <-t.C:
				elapsed += 8
				m.logf("info", "Still working… %ds", elapsed)
			}
		}
	}()
	defer close(hbDone)

	var (
		mu  sync.Mutex
		buf strings.Builder
		wg  sync.WaitGroup
	)
	scan := func(r io.Reader) {
		defer wg.Done()
		s := bufio.NewScanner(r)
		s.Buffer(make([]byte, 0, 64*1024), 512*1024)
		for s.Scan() {
			line := s.Text()
			mu.Lock()
			buf.WriteString(line)
			buf.WriteByte('\n')
			mu.Unlock()
			m.logf(classifyCmdLine(line), "%s", line)
		}
	}

	wg.Add(2)
	go scan(stdout)
	go scan(stderr)
	wg.Wait()
	err = cmd.Wait()
	out := buf.String()
	if err != nil {
		msg := strings.TrimSpace(out)
		if msg == "" {
			msg = err.Error()
		}
		m.logf("err", "%s", msg)
		return out, fmt.Errorf("%s", msg)
	}
	return out, nil
}

// classifyCmdLine maps tool output to activity levels for correct console colors.
// Prefer explicit slog/zerolog level= keys so WARN lines with error= fields stay yellow.
func classifyCmdLine(line string) string {
	s := strings.TrimSpace(line)
	if s == "" {
		return "out"
	}
	low := strings.ToLower(s)
	if lv := slogLevel(low); lv != "" {
		return lv
	}
	switch {
	case strings.HasPrefix(low, "panic:") || strings.HasPrefix(low, "fatal:") ||
		strings.HasPrefix(low, "error:") || strings.HasPrefix(low, "err:"):
		return "err"
	case strings.HasPrefix(low, "warning:") || strings.HasPrefix(low, "warn:") ||
		strings.Contains(low, " does not support ") ||
		strings.Contains(low, "limitation discarded") || strings.Contains(low, "cgroup") ||
		strings.HasPrefix(low, "deprecated") || strings.Contains(low, "not supported"):
		return "warn"
	default:
		return "out"
	}
}

func slogLevel(low string) string {
	for _, key := range []string{"level=", "level:"} {
		if i := strings.Index(low, key); i >= 0 {
			rest := low[i+len(key):]
			end := len(rest)
			for j, r := range rest {
				if (r < 'a' || r > 'z') && r != '_' {
					end = j
					break
				}
			}
			lv := rest[:end]
			switch lv {
			case "error", "err", "fatal", "panic":
				return "err"
			case "warn", "warning":
				return "warn"
			case "info", "debug", "trace":
				return "info"
			default:
				return "out"
			}
		}
	}
	return ""
}
