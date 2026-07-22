package deploy

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// DockerDaemonStatus is the host Docker Engine (dockerd) state.
type DockerDaemonStatus struct {
	Running bool   `json:"running"`
	Active  string `json:"active"` // systemd ActiveState: active|inactive|failed|…
	Enabled bool   `json:"enabled"`
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
}

func systemctlOutput(ctx context.Context, args ...string) (string, error) {
	cmdArgs := append([]string{"-n", "systemctl"}, args...)
	cmd := exec.CommandContext(ctx, "sudo", cmdArgs...)
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		if s == "" {
			return "", err
		}
		return s, fmt.Errorf("%w: %s", err, s)
	}
	return s, nil
}

// DockerDaemon reports whether dockerd is up (via systemd + optional version probe).
func (m *Manager) DockerDaemon(ctx context.Context) DockerDaemonStatus {
	st := DockerDaemonStatus{Active: "unknown"}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	active, err := systemctlOutput(ctx, "is-active", "docker.service")
	if err != nil {
		// is-active returns non-zero for inactive/failed — still parse the word.
		active = strings.TrimSpace(active)
		if active == "" {
			st.Error = err.Error()
			st.Active = "unknown"
			return st
		}
	}
	st.Active = strings.ToLower(strings.TrimSpace(active))
	st.Running = st.Active == "active"

	if en, err := systemctlOutput(ctx, "is-enabled", "docker.service"); err == nil {
		st.Enabled = strings.TrimSpace(en) == "enabled"
	} else {
		en = strings.TrimSpace(en)
		st.Enabled = en == "enabled"
	}

	if st.Running {
		if ver, err := m.dockerQuiet(ctx, "version", "--format", "{{.Server.Version}}"); err == nil {
			st.Version = strings.TrimSpace(ver)
		}
	}
	return st
}

// StartDockerDaemon starts dockerd via systemd (passwordless sudo).
func (m *Manager) StartDockerDaemon(ctx context.Context) (DockerDaemonStatus, error) {
	if err := m.acquireJob("Start Docker daemon", "engine/docker"); err != nil {
		return m.DockerDaemon(ctx), err
	}
	m.startProgress([]ProgressStep{
		{ID: "start", Label: "Start dockerd", Weight: 100, Status: "pending"},
	})
	m.stepProgress("start")
	m.logf("step", "systemctl start docker.service")
	if _, err := systemctlOutput(ctx, "start", "docker.service"); err != nil {
		m.releaseJob(false, err.Error())
		return m.DockerDaemon(ctx), err
	}
	// Brief settle so the socket is ready for follow-up docker calls.
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		st := m.DockerDaemon(ctx)
		if st.Running {
			if st.Version != "" {
				m.logf("ok", "Docker daemon active · %s", st.Version)
			} else {
				m.logf("ok", "Docker daemon active")
			}
			m.releaseJob(true, "Docker daemon running")
			return st, nil
		}
		select {
		case <-ctx.Done():
			m.releaseJob(false, ctx.Err().Error())
			return st, ctx.Err()
		case <-time.After(400 * time.Millisecond):
		}
	}
	st := m.DockerDaemon(ctx)
	if !st.Running {
		err := fmt.Errorf("docker.service did not become active")
		m.releaseJob(false, err.Error())
		return st, err
	}
	m.releaseJob(true, "Docker daemon running")
	return st, nil
}

// StopDockerDaemon stops dockerd. All containers lose the runtime until started again.
func (m *Manager) StopDockerDaemon(ctx context.Context) (DockerDaemonStatus, error) {
	if err := m.acquireJob("Stop Docker daemon", "engine/docker"); err != nil {
		return m.DockerDaemon(ctx), err
	}
	m.startProgress([]ProgressStep{
		{ID: "stop", Label: "Stop dockerd", Weight: 100, Status: "pending"},
	})
	m.stepProgress("stop")
	m.logf("warn", "Stopping Docker stops every container on this Pi")
	m.logf("step", "systemctl stop docker.service")
	if _, err := systemctlOutput(ctx, "stop", "docker.service"); err != nil {
		m.releaseJob(false, err.Error())
		return m.DockerDaemon(ctx), err
	}
	st := m.DockerDaemon(ctx)
	m.logf("ok", "Docker daemon stopped")
	m.releaseJob(true, "Docker daemon stopped")
	return st, nil
}
