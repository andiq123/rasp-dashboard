package deploy

import (
	"context"
	"strconv"
	"strings"
)

// ManageOverview is a single snapshot for the Storage / Network tabs.
type ManageOverview struct {
	DeployBytes int64           `json:"deploy_bytes"`
	CacheBytes  int64           `json:"cache_bytes"`
	GroupBytes  int64           `json:"group_bytes"`
	Published   []PublishedPort `json:"published"`
	Docker      DockerInventory `json:"docker"`
	DockerError string          `json:"docker_error,omitempty"`
}

// PublishedPort is a service or container reachable on the Pi.
type PublishedPort struct {
	Kind    string `json:"kind"`
	Group   string `json:"group,omitempty"`
	Slug    string `json:"slug,omitempty"`
	Name    string `json:"name"`
	Port    int    `json:"port,omitempty"`
	URL     string `json:"url,omitempty"`
	Running bool   `json:"running"`
	Status  string `json:"status,omitempty"`
}

// ManageOverview builds storage + published network endpoints.
func (m *Manager) ManageOverview(ctx context.Context) (ManageOverview, error) {
	out := ManageOverview{
		DeployBytes: dirSize(m.DeployDir),
		CacheBytes:  dirSize(m.DeployDir + "/cache"),
		GroupBytes:  dirSize(m.DeployDir + "/groups"),
		Published:   []PublishedPort{},
		Docker: DockerInventory{
			Disk:       []DockerDiskRow{},
			Images:     []DockerImage{},
			Containers: []DockerContainer{},
			Volumes:    []DockerVolume{},
		},
	}

	if inv, err := m.DockerInventory(ctx); err == nil {
		if inv.Disk == nil {
			inv.Disk = []DockerDiskRow{}
		}
		if inv.Images == nil {
			inv.Images = []DockerImage{}
		}
		if inv.Containers == nil {
			inv.Containers = []DockerContainer{}
		}
		if inv.Volumes == nil {
			inv.Volumes = []DockerVolume{}
		}
		out.Docker = inv
	} else {
		out.DockerError = err.Error()
	}

	m.mu.Lock()
	reg, err := m.loadRegistry()
	var services []Service
	if err == nil {
		_ = m.adoptOrphansLocked(&reg)
		services = append(services, reg.Services...)
	}
	m.mu.Unlock()

	for _, s := range services {
		s = m.refreshStatus(ctx, s)
		pp := PublishedPort{
			Kind:    s.Type,
			Group:   s.Group,
			Slug:    s.Slug,
			Name:    s.Name,
			Port:    s.Port,
			URL:     s.URL,
			Running: s.Running,
			Status:  s.Status,
		}
		if s.Type == TypePostgres {
			pp.Port = 5432
			pp.URL = ""
		}
		out.Published = append(out.Published, pp)
	}

	seen := map[int]bool{}
	for _, p := range out.Published {
		if p.Port > 0 {
			seen[p.Port] = true
		}
	}
	for _, c := range out.Docker.Containers {
		if !c.Running {
			continue
		}
		for _, port := range m.containerHostPorts(ctx, c.Name) {
			if seen[port] {
				continue
			}
			seen[port] = true
			out.Published = append(out.Published, PublishedPort{
				Kind:    "container",
				Name:    c.Name,
				Port:    port,
				URL:     "http://rasp.local:" + strconv.Itoa(port),
				Running: true,
				Status:  c.Status,
			})
		}
	}

	// Stable order: running first, then port, then name.
	for i := 0; i < len(out.Published); i++ {
		for j := i + 1; j < len(out.Published); j++ {
			a, b := out.Published[i], out.Published[j]
			swap := false
			if a.Running != b.Running {
				swap = !a.Running && b.Running
			} else if a.Port != b.Port {
				swap = a.Port > b.Port
			} else {
				swap = a.Name > b.Name
			}
			if swap {
				out.Published[i], out.Published[j] = b, a
			}
		}
	}
	return out, nil
}

func (m *Manager) containerHostPorts(ctx context.Context, name string) []int {
	out, err := m.dockerQuiet(ctx, "inspect", "-f",
		`{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}} {{end}}{{end}}`,
		name)
	if err != nil {
		return nil
	}
	var ports []int
	seen := map[int]bool{}
	for _, part := range strings.Fields(out) {
		n, err := strconv.Atoi(part)
		if err != nil || n <= 0 || seen[n] {
			continue
		}
		seen[n] = true
		ports = append(ports, n)
	}
	return ports
}
