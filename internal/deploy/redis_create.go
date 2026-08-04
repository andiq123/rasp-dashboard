package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const redisImage = "redis:7.4-alpine"

func redisVolumeName(group, slug string) string {
	return containerName(group, slug) + "-data"
}

// CreateRedis provisions a dedicated password-protected Redis container.
// Each service owns its container, loopback-only port, credentials, and volume.
func (m *Manager) CreateRedis(ctx context.Context, group, name string) (Service, error) {
	started, queued, next, err := m.reserveOrEnqueueCreate(TypeRedis, group, name, "")
	if err != nil {
		return Service{}, err
	}
	if !started {
		return queued, nil
	}
	return m.executeQueuedCreate(ctx, next)
}

func (m *Manager) createRedis(ctx context.Context, group, name string) (Service, error) {
	m.stepProgress("prepare")
	m.mu.Lock()
	reg, err := m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		return Service{}, err
	}
	if _, idx := findGroup(reg, group); idx < 0 {
		m.mu.Unlock()
		return Service{}, fmt.Errorf("group not found — create a group first")
	}
	if name == "" {
		m.mu.Unlock()
		return Service{}, fmt.Errorf("name required")
	}
	slug := slugify(name)
	if slug == "" {
		m.mu.Unlock()
		return Service{}, fmt.Errorf("invalid name")
	}
	if _, idx := findService(reg, group, slug); idx >= 0 {
		m.mu.Unlock()
		return Service{}, fmt.Errorf("service already exists in group")
	}
	port, err := m.pickPort(reg)
	if err != nil {
		m.mu.Unlock()
		return Service{}, err
	}
	mem, cpus := clampResources(256, 0.5)
	password := randomHex(32)
	volume := redisVolumeName(group, slug)
	dir := m.serviceDir(group, slug)
	if err := m.ensureServiceLayout(group, slug); err != nil {
		m.mu.Unlock()
		return Service{}, err
	}
	envBody := clearEnvKeys(redisServiceEnv("127.0.0.1", port, password), frameworkEnvKeys...)
	if err := os.WriteFile(filepath.Join(dir, "env"), []byte(normalizeEnv(envBody)), 0o600); err != nil {
		m.mu.Unlock()
		return Service{}, err
	}
	svc := Service{
		Group: group, Slug: slug, Type: TypeRedis, Name: name,
		Port: port, MemoryMB: mem, CPUs: cpus, Volume: volume,
		EngineImage: redisImage, ConnectionURL: buildRedisURL("127.0.0.1", port, password),
		Status: "creating", UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	// Write recovery metadata before Docker work so a host restart can adopt
	// this directory as Redis rather than mistaking it for an app service.
	if err := m.writeMeta(svc); err != nil {
		m.mu.Unlock()
		m.purgeServiceFiles(group, slug)
		return Service{}, err
	}
	m.mu.Unlock()

	m.stepProgress("volume")
	m.logf("step", "Creating private Redis volume %s", volume)
	volumeArgs := []string{"volume", "create"}
	volumeArgs = append(volumeArgs, dockerScopeLabels(group, slug, "data")...)
	volumeArgs = append(volumeArgs, volume)
	if _, err := m.dockerLogged(ctx, false, volumeArgs...); err != nil {
		m.purgeServiceFiles(group, slug)
		return Service{}, fmt.Errorf("redis volume: %w", err)
	}

	m.stepProgress("container")
	if err := m.runRedisContainer(ctx, svc); err != nil {
		m.stopContainer(ctx, containerName(group, slug))
		_, _ = m.dockerQuiet(ctx, "volume", "rm", volume)
		m.purgeServiceFiles(group, slug)
		return Service{}, err
	}

	m.stepProgress("register")
	svc.Running = true
	svc.Status = "running"
	svc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.mu.Lock()
	reg, err = m.loadRegistry()
	if err != nil {
		m.mu.Unlock()
		m.cleanupFailedRedis(ctx, group, slug, volume)
		return Service{}, err
	}
	if _, idx := findService(reg, group, slug); idx >= 0 {
		m.mu.Unlock()
		m.cleanupFailedRedis(ctx, group, slug, volume)
		return Service{}, fmt.Errorf("service already exists in group")
	}
	reg.Services = append(reg.Services, svc)
	if err := m.saveRegistry(reg); err != nil {
		m.mu.Unlock()
		m.cleanupFailedRedis(ctx, group, slug, volume)
		return Service{}, err
	}
	_ = m.writeMeta(svc)
	m.mu.Unlock()
	m.logf("ok", "Redis ready · 127.0.0.1:%d · private container", port)
	return svc, nil
}

func (m *Manager) cleanupFailedRedis(ctx context.Context, group, slug, volume string) {
	m.stopContainer(ctx, containerName(group, slug))
	_, _ = m.dockerQuiet(ctx, "volume", "rm", volume)
	m.purgeServiceFiles(group, slug)
}

func (m *Manager) runRedisContainer(ctx context.Context, svc Service) error {
	name := containerName(svc.Group, svc.Slug)
	mem, cpus := clampResources(svc.MemoryMB, svc.CPUs)
	envPath := filepath.Join(m.serviceDir(svc.Group, svc.Slug), "env")
	mp := m.readServiceEnvMap(svc.Group, svc.Slug)
	password := envGet(mp, "REDIS_PASSWORD")
	if password == "" || svc.Port <= 0 {
		return fmt.Errorf("redis credentials or port missing")
	}
	volume := strings.TrimSpace(svc.Volume)
	if volume == "" {
		volume = redisVolumeName(svc.Group, svc.Slug)
	}
	m.removeServiceContainers(ctx, svc.Group, svc.Slug)
	maxMemory := mem * 3 / 4
	if maxMemory < 48 {
		maxMemory = 48
	}
	runArgs := []string{
		"run", "-d", "--name", name,
		"--init", "--pids-limit", "128", "--stop-timeout", "15",
		"--restart", "unless-stopped",
		"--publish", fmt.Sprintf("127.0.0.1:%d:6379", svc.Port),
		"--env-file", envPath,
		"--volume", volume + ":/data",
		"--cpus", formatCPUs(cpus),
		"--log-opt", "max-size=10m", "--log-opt", "max-file=3",
		"--health-cmd", `REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning ping || exit 1`,
		"--health-start-period", "3s", "--health-interval", "3s",
		"--health-timeout", "2s", "--health-retries", "10",
	}
	if cgroupMemorySupported() {
		runArgs = append(runArgs, "--memory", fmt.Sprintf("%dm", mem))
	}
	runArgs = append(runArgs, dockerScopeLabels(svc.Group, svc.Slug, "runtime")...)
	runArgs = append(runArgs,
		redisImage, "redis-server",
		"--protected-mode", "yes",
		"--appendonly", "yes",
		"--appendfsync", "everysec",
		"--save", "",
		"--maxmemory", fmt.Sprintf("%dmb", maxMemory),
		"--maxmemory-policy", "noeviction",
		"--requirepass", password,
	)
	if _, err := m.dockerLogged(ctx, true, runArgs...); err != nil {
		return fmt.Errorf("start redis: %w", err)
	}
	m.stepProgress("health")
	if err := m.waitRedisHealthy(ctx, name, svc.Port); err != nil {
		logs, _ := m.TailContainerLogs(ctx, svc.Group, svc.Slug, 40)
		if strings.TrimSpace(logs) != "" {
			m.logAppOutput("Redis logs", logs)
		}
		return fmt.Errorf("redis health: %w", err)
	}
	return nil
}

// waitRedisHealthy requires Docker's authenticated redis-cli PING healthcheck
// to pass. A listening TCP port alone is not enough: Redis may be starting,
// loading its AOF, or rejecting authentication.
func (m *Manager) waitRedisHealthy(ctx context.Context, name string, port int) error {
	deadline := time.Now().Add(45 * time.Second)
	lastHealth := "starting"
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return err
		}
		st := m.inspectContainer(ctx, name)
		if st.Status == "missing" {
			lastHealth = "container missing"
		} else if st.Restarting || st.Status == "exited" || st.Status == "dead" {
			return fmt.Errorf("container %s (exit %d)", st.Status, st.ExitCode)
		} else if st.Running {
			out, err := m.dockerQuiet(ctx, "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}", name)
			if err == nil {
				lastHealth = strings.TrimSpace(out)
				if lastHealth == "healthy" {
					if port <= 0 || m.portOpen(port) {
						return nil
					}
					lastHealth = fmt.Sprintf("healthy but loopback port %d is closed", port)
				} else if lastHealth == "unhealthy" {
					return fmt.Errorf("authenticated PING failed")
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("authenticated PING not ready in time (%s)", lastHealth)
}
