package deploy

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"
)

type containerState struct {
	Running    bool
	Status     string // running | restarting | exited | created | ...
	ExitCode   int
	OOMKilled  bool
	Error      string
	Restarting bool
}

func (m *Manager) inspectContainer(ctx context.Context, name string) containerState {
	out, err := m.dockerQuiet(ctx, "inspect", "-f",
		"{{.State.Running}}|{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Error}}",
		name)
	if err != nil {
		return containerState{Status: "missing"}
	}
	parts := strings.Split(strings.TrimSpace(out), "|")
	for len(parts) < 5 {
		parts = append(parts, "")
	}
	st := containerState{
		Running:   parts[0] == "true",
		Status:    parts[1],
		OOMKilled: parts[3] == "true",
		Error:     parts[4],
	}
	fmt.Sscanf(parts[2], "%d", &st.ExitCode)
	st.Restarting = st.Status == "restarting" || (st.Running && st.Status == "restarting")
	if st.Status == "restarting" {
		st.Restarting = true
	}
	return st
}

func (m *Manager) containerStable(ctx context.Context, name string) bool {
	st := m.inspectContainer(ctx, name)
	return st.Running && st.Status == "running" && !st.Restarting
}

func (m *Manager) containerRunning(ctx context.Context, name string) bool {
	return m.containerStable(ctx, name)
}

// TailContainerLogs returns recent runtime logs (crash output).
func (m *Manager) TailContainerLogs(ctx context.Context, group, slug string, lines int) (string, error) {
	if err := requireSlug(group, "group"); err != nil {
		return "", err
	}
	if err := requireSlug(slug, "service"); err != nil {
		return "", err
	}
	if lines <= 0 || lines > 200 {
		lines = 80
	}
	name := containerName(group, slug)
	// docker logs prints on stderr; CombinedOutput captures both.
	out, err := runCmd(ctx, "sudo", "-n", "docker", "logs", "--tail", fmt.Sprintf("%d", lines), name)
	out = strings.TrimSpace(out)
	if out == "" && err != nil {
		return "", fmt.Errorf("no container logs: %w", err)
	}
	return out, nil
}

func (m *Manager) logAppOutput(title, body string) {
	body = strings.TrimSpace(body)
	if body == "" {
		m.logf("warn", "%s (empty)", title)
		return
	}
	m.logf("step", "—— %s ——", title)
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		m.logf(classifyCmdLine(line), "%s", line)
	}
	summary := summarizeCrash(body)
	if summary != "" {
		m.logf("err", "Cause · %s", summary)
	}
}

func summarizeCrash(logs string) string {
	logs = strings.TrimSpace(logs)
	if logs == "" {
		return "container crashed"
	}
	lines := strings.Split(logs, "\n")
	// Prefer panic / error lines from the end.
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			continue
		}
		low := strings.ToLower(l)
		if strings.Contains(low, "panic:") || strings.Contains(low, "failed to connect") || strings.Contains(low, "level=error") || strings.Contains(low, "fatal") {
			if len(l) > 180 {
				l = l[:180] + "…"
			}
			return l
		}
	}
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if l != "" {
			if len(l) > 180 {
				l = l[:180] + "…"
			}
			return l
		}
	}
	return "container crashed"
}

func (m *Manager) portOpen(port int) bool {
	if port <= 0 {
		return false
	}
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 400*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
