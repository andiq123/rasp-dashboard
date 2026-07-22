package deploy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var slugRe = regexp.MustCompile(`[^a-z0-9-]+`)

const (
	TypeGo       = "go"
	TypePostgres = "postgres"

	defaultMemoryMB = 512
	defaultCPUs   = 1.0
	defaultBranch   = "main"
	portStart       = 5100
	portEnd         = 5199
)

type Group struct {
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	UpdatedAt    string `json:"updated_at"`
	DiskBytes    int64  `json:"disk_bytes,omitempty"`
	ServiceCount int    `json:"service_count,omitempty"`
	RenamedFrom  string `json:"renamed_from,omitempty"`
}

type Service struct {
	Group          string  `json:"group"`
	Slug           string  `json:"slug"`
	Type           string  `json:"type"`
	Name           string  `json:"name"`
	Repo           string  `json:"repo,omitempty"`
	Branch         string  `json:"branch,omitempty"`
	Port           int     `json:"port,omitempty"`
	Cmd            string  `json:"cmd,omitempty"`
	RootDir        string  `json:"root_dir,omitempty"`
	BuildCmd       string  `json:"build_cmd,omitempty"`
	GoToolchain    string  `json:"go_toolchain,omitempty"`
	MemoryMB       int     `json:"memory_mb,omitempty"`
	CPUs         float64 `json:"cpus,omitempty"`
	Running        bool    `json:"running"`
	URL            string  `json:"url,omitempty"`
	PublicURL      string  `json:"public_url,omitempty"`
	StaticHost     string  `json:"static_host,omitempty"`
	TunnelActive   bool    `json:"tunnel_active,omitempty"`
	ConnectionURL  string  `json:"connection_url,omitempty"`
	Database       string  `json:"database,omitempty"`
	Volume         string  `json:"volume,omitempty"`
	VolumeSize     string  `json:"volume_size,omitempty"`
	VolumeBytes    int64   `json:"volume_bytes,omitempty"`
	EngineImage    string  `json:"engine_image,omitempty"`
	LinkedDatabase string  `json:"linked_database,omitempty"`
	Status         string  `json:"status,omitempty"`
	LastError      string  `json:"last_error,omitempty"`
	HasClone       bool    `json:"has_clone,omitempty"`
	CloneBytes     int64   `json:"clone_bytes,omitempty"`
	BinaryBytes    int64   `json:"binary_bytes,omitempty"`
	DiskBytes      int64        `json:"disk_bytes,omitempty"`
	ActiveDeployID string       `json:"active_deploy_id,omitempty"`
	DeployID       string       `json:"deploy_id,omitempty"`
	Deployments    []Deployment `json:"deployments,omitempty"`
	AutoDeploy     bool          `json:"auto_deploy,omitempty"`
	AutoDeploySet  bool          `json:"auto_deploy_set,omitempty"`
	DeploySHA      string        `json:"deploy_sha,omitempty"`
	Stats          *RuntimeStats `json:"stats,omitempty"`
	UpdatedAt      string        `json:"updated_at"`
}

type registry struct {
	Groups   []Group   `json:"groups"`
	Services []Service `json:"services"`
}

type Manifest struct {
	Cmd      string  `json:"cmd"`
	Port     int     `json:"port"`
	RootDir  string  `json:"root_dir"`
	BuildCmd string  `json:"build_cmd"`
	MemoryMB int     `json:"memory_mb"`
	CPUs   float64 `json:"cpus"`
}

type CreateGroupRequest struct {
	Name string `json:"name"`
}

type CreateGoRequest struct {
	Repo           string  `json:"repo"`
	Branch         string  `json:"branch"`
	Name           string  `json:"name"`
	LinkedDatabase string  `json:"linked_database"`
	RootDir        string  `json:"root_dir"`
	BuildCmd       string  `json:"build_cmd"`
	GoToolchain    string  `json:"go_toolchain"`
	MemoryMB       int     `json:"memory_mb"`
	CPUs         float64 `json:"cpus"`
	Env            string  `json:"env"`
}

type CreatePostgresRequest struct {
	Name     string  `json:"name"`
	Version  string  `json:"version"` // latest | 17 | 16 | 15 — applies engine image before create
	MemoryMB int     `json:"memory_mb"`
	CPUs   float64 `json:"cpus"`
}

type SettingsUpdate struct {
	Name           *string  `json:"name"`
	Branch         *string  `json:"branch"`
	LinkedDatabase *string  `json:"linked_database"`
	RootDir        *string  `json:"root_dir"`
	Env            *string  `json:"env"`
	BuildCmd       *string  `json:"build_cmd"`
	MemoryMB       *int     `json:"memory_mb"`
	CPUs         *float64 `json:"cpus"`
	AutoDeploy     *bool    `json:"auto_deploy"`
}

type GroupSettingsUpdate struct {
	Name *string `json:"name"`
	Env  *string `json:"env"`
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func normalizeRepo(repo string) string {
	repo = strings.TrimSpace(repo)
	repo = strings.TrimSuffix(repo, ".git")
	repo = strings.TrimPrefix(repo, "https://github.com/")
	repo = strings.TrimPrefix(repo, "http://github.com/")
	repo = strings.TrimPrefix(repo, "git@github.com:")
	repo = strings.Trim(repo, "/")
	parts := strings.Split(repo, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return ""
	}
	return parts[0] + "/" + parts[1]
}

func containerName(group, slug string) string {
	return "fw-" + group + "-" + slug
}

// buildContainerName is the ephemeral compile container (always --rm).
func buildContainerName(group, slug string) string {
	return "fw-build-" + group + "-" + slug
}

// Docker label keys — group/service scoped cleanup relies on these.
const (
	labelManaged = "firewifi.managed"
	labelApp     = "firewifi.app"
	labelGroup   = "firewifi.group"
	labelService = "firewifi.service"
	labelRole    = "firewifi.role"
)

// dockerScopeLabels returns --label args for managed containers.
// role: "runtime" | "build"
func dockerScopeLabels(group, slug, role string) []string {
	return []string{
		"--label", labelManaged + "=1",
		"--label", labelApp + "=dashboard",
		"--label", labelGroup + "=" + group,
		"--label", labelService + "=" + slug,
		"--label", labelRole + "=" + role,
	}
}

func (m *Manager) groupDir(group string) string {
	return filepath.Join(m.DeployDir, "groups", group)
}

func (m *Manager) serviceDir(group, slug string) string {
	return filepath.Join(m.groupDir(group), slug)
}

func (m *Manager) loadRegistry() (registry, error) {
	path := filepath.Join(m.DeployDir, "registry.json")
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return registry{Groups: []Group{}, Services: []Service{}}, nil
		}
		return registry{}, err
	}
	var reg registry
	if err := json.Unmarshal(b, &reg); err != nil {
		return registry{}, err
	}
	if reg.Groups == nil {
		reg.Groups = []Group{}
	}
	if reg.Services == nil {
		reg.Services = []Service{}
	}
	// migrate flat services without group
	changed := false
	if len(reg.Services) > 0 {
		hasDefault := false
		for _, g := range reg.Groups {
			if g.Slug == "default" {
				hasDefault = true
				break
			}
		}
		for i := range reg.Services {
			if reg.Services[i].Group == "" {
				if !hasDefault {
					reg.Groups = append(reg.Groups, Group{Slug: "default", Name: "Default"})
					hasDefault = true
				}
				reg.Services[i].Group = "default"
				changed = true
			}
			if reg.Services[i].Type == "" {
				reg.Services[i].Type = TypeGo
				changed = true
			}
			if reg.Services[i].Name == "" {
				reg.Services[i].Name = reg.Services[i].Slug
				changed = true
			}
			if reg.Services[i].Type == TypeGo {
				if reg.Services[i].MemoryMB <= 0 {
					reg.Services[i].MemoryMB = defaultMemoryMB
					changed = true
				}
				if reg.Services[i].CPUs <= 0 {
					reg.Services[i].CPUs = defaultCPUs
					changed = true
				}
			}
		}
	}
	if changed {
		_ = m.saveRegistry(reg)
	}
	return reg, nil
}

func (m *Manager) saveRegistry(reg registry) error {
	if err := m.ensureDirs(); err != nil {
		return err
	}
	safe := reg
	safe.Groups = append([]Group(nil), reg.Groups...)
	safe.Services = append([]Service(nil), reg.Services...)
	if safe.Groups == nil {
		safe.Groups = []Group{}
	}
	if safe.Services == nil {
		safe.Services = []Service{}
	}
	for i := range safe.Services {
		if safe.Services[i].Type == TypePostgres {
			safe.Services[i].ConnectionURL = ""
		}
		safe.Services[i].Stats = nil
	}
	b, err := json.MarshalIndent(safe, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(m.DeployDir, "registry.json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (m *Manager) writeMeta(svc Service) error {
	dir := m.serviceDir(svc.Group, svc.Slug)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	safe := svc
	if safe.Type == TypePostgres {
		safe.ConnectionURL = ""
	}
	safe.Stats = nil
	b, err := json.MarshalIndent(safe, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "meta.json"), append(b, '\n'), 0o600)
}

func findGroup(reg registry, slug string) (Group, int) {
	for i, g := range reg.Groups {
		if g.Slug == slug {
			return g, i
		}
	}
	return Group{}, -1
}

func findService(reg registry, group, slug string) (Service, int) {
	for i, s := range reg.Services {
		if s.Group == group && s.Slug == slug {
			return s, i
		}
	}
	return Service{}, -1
}

// --- env helpers ---

func normalizeEnv(body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return ""
	}
	// Accept JSON object paste
	if strings.HasPrefix(body, "{") {
		var obj map[string]interface{}
		if err := json.Unmarshal([]byte(body), &obj); err == nil {
			lines := make([]string, 0, len(obj))
			for k, v := range obj {
				k = strings.TrimSpace(k)
				if k == "" {
					continue
				}
				lines = append(lines, k+"="+fmt.Sprint(v))
			}
			sortStrings(lines)
			return strings.Join(lines, "\n") + "\n"
		}
	}
	lines := strings.Split(body, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		out = append(out, line)
	}
	if len(out) == 0 {
		return ""
	}
	return strings.Join(out, "\n") + "\n"
}

func sortStrings(a []string) { sort.Strings(a) }

func upsertEnv(body, key, value string) string {
	lines := strings.Split(normalizeEnv(body), "\n")
	prefix := key + "="
	found := false
	out := make([]string, 0, len(lines)+1)
	for _, line := range lines {
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, prefix) {
			out = append(out, prefix+value)
			found = true
			continue
		}
		out = append(out, line)
	}
	if !found {
		out = append(out, prefix+value)
	}
	return strings.Join(out, "\n") + "\n"
}

func removeEnvKey(body, key string) string {
	lines := strings.Split(normalizeEnv(body), "\n")
	prefix := key + "="
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		if line == "" || strings.HasPrefix(line, prefix) {
			continue
		}
		out = append(out, line)
	}
	if len(out) == 0 {
		return ""
	}
	return strings.Join(out, "\n") + "\n"
}

func parseEnvMap(body string) map[string]string {
	m := map[string]string{}
	s := bufio.NewScanner(strings.NewReader(normalizeEnv(body)))
	for s.Scan() {
		line := s.Text()
		if i := strings.IndexByte(line, '='); i > 0 {
			m[line[:i]] = line[i+1:]
		}
	}
	return m
}

func mergeEnvFiles(groupEnv, svcEnv string) string {
	merged := parseEnvMap(groupEnv)
	for k, v := range parseEnvMap(svcEnv) {
		merged[k] = v // service overrides group
	}
	keys := make([]string, 0, len(merged))
	for k := range merged {
		keys = append(keys, k)
	}
	sortStrings(keys)
	lines := make([]string, 0, len(keys))
	for _, k := range keys {
		lines = append(lines, k+"="+merged[k])
	}
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n"
}

func envToJSON(body string) string {
	m := parseEnvMap(body)
	b, _ := json.MarshalIndent(m, "", "  ")
	if len(m) == 0 {
		return "{}"
	}
	return string(b)
}

func clampResources(mem int, cpus float64) (int, float64) {
	if mem <= 0 {
		mem = defaultMemoryMB
	}
	if mem < 64 {
		mem = 64
	}
	if mem > 3072 {
		mem = 3072
	}
	if cpus <= 0 {
		cpus = defaultCPUs
	}
	if cpus < 0.1 {
		cpus = 0.1
	}
	if cpus > 4 {
		cpus = 4
	}
	// keep one decimal
	cpus = float64(int(cpus*10+0.5)) / 10
	return mem, cpus
}

func formatCPUs(c float64) string {
	return strconv.FormatFloat(c, 'f', -1, 64)
}
