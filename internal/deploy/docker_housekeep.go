package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// DockerDiskRow is one line from `docker system df`.
type DockerDiskRow struct {
	Type             string `json:"type"`
	TotalCount       int    `json:"total_count"`
	Active           int    `json:"active"`
	Size             string `json:"size"`
	SizeBytes        int64  `json:"size_bytes"`
	Reclaimable      string `json:"reclaimable"`
	ReclaimableBytes int64  `json:"reclaimable_bytes"`
	ReclaimablePct   int    `json:"reclaimable_pct"`
}

// DockerImage is a local image with usage hints.
type DockerImage struct {
	ID           string `json:"id"`
	Repository   string `json:"repository"`
	Tag          string `json:"tag"`
	Ref          string `json:"ref"`
	Size         string `json:"size"`
	SizeBytes    int64  `json:"size_bytes"`
	Containers   int    `json:"containers"`
	CreatedSince string `json:"created_since"`
	Dangling     bool   `json:"dangling"`
	InUse        bool   `json:"in_use"`
}

// DockerContainer is a local container.
type DockerContainer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Image   string `json:"image"`
	State   string `json:"state"`
	Status  string `json:"status"`
	Size    string `json:"size"`
	Running bool   `json:"running"`
	Managed bool   `json:"managed"`
	Group   string `json:"group,omitempty"`
	Service string `json:"service,omitempty"`
	Role    string `json:"role,omitempty"`
	Project string `json:"project,omitempty"`
}

// DockerVolume is a named volume.
type DockerVolume struct {
	Name       string `json:"name"`
	Driver     string `json:"driver"`
	Size       string `json:"size"`
	SizeBytes  int64  `json:"size_bytes"`
	InUse      bool   `json:"in_use"`
	Mountpoint string `json:"mountpoint,omitempty"`
}

// DockerInventory is the full Docker resource snapshot for the UI.
type DockerInventory struct {
	Disk         []DockerDiskRow   `json:"disk"`
	Images       []DockerImage     `json:"images"`
	Containers   []DockerContainer `json:"containers"`
	Volumes      []DockerVolume    `json:"volumes"`
	TotalBytes   int64             `json:"total_bytes"`
	ReclaimBytes int64             `json:"reclaim_bytes"`
	FetchedAt    string            `json:"fetched_at"`
}

// DockerAction is a housekeeping operation requested by the UI.
type DockerAction struct {
	Action     string `json:"action"`
	ID         string `json:"id,omitempty"`
	Force      bool   `json:"force,omitempty"`
	Images     bool   `json:"images,omitempty"`
	Containers bool   `json:"containers,omitempty"`
	Volumes    bool   `json:"volumes,omitempty"`
	BuildCache bool   `json:"build_cache,omitempty"`
	AllUnused  bool   `json:"all_unused,omitempty"`
}

// DockerActionResult summarizes what changed.
type DockerActionResult struct {
	OK      bool   `json:"ok"`
	Action  string `json:"action"`
	Message string `json:"message"`
	Output  string `json:"output,omitempty"`
}

var dockerSizeRe = regexp.MustCompile(`(?i)^([\d.]+)\s*([kmgt]?i?b)$`)
var dockerReclaimRe = regexp.MustCompile(`(?i)^([\d.]+)\s*([kmgt]?i?b)\s*\((\d+)%\)`)

func parseDockerSize(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "0B" || s == "0" {
		return 0
	}
	m := dockerSizeRe.FindStringSubmatch(s)
	if m == nil {
		return 0
	}
	n, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0
	}
	unit := strings.ToLower(m[2])
	mult := float64(1)
	switch unit {
	case "kb", "kib":
		mult = 1024
	case "mb", "mib":
		mult = 1024 * 1024
	case "gb", "gib":
		mult = 1024 * 1024 * 1024
	case "tb", "tib":
		mult = 1024 * 1024 * 1024 * 1024
	}
	return int64(n * mult)
}

func parseReclaimable(s string) (bytes int64, pct int) {
	s = strings.TrimSpace(s)
	m := dockerReclaimRe.FindStringSubmatch(s)
	if m != nil {
		bytes = parseDockerSize(m[1] + m[2])
		pct, _ = strconv.Atoi(m[3])
		return bytes, pct
	}
	return parseDockerSize(s), 0
}

func (m *Manager) DockerInventory(ctx context.Context) (DockerInventory, error) {
	inv := DockerInventory{
		FetchedAt: time.Now().UTC().Format(time.RFC3339),
	}
	diskOut, err := m.dockerQuiet(ctx, "system", "df", "--format", "{{json .}}")
	if err != nil {
		return inv, fmt.Errorf("docker system df: %w", err)
	}
	for _, line := range splitJSONLines(diskOut) {
		var raw struct {
			Type        string `json:"Type"`
			TotalCount  string `json:"TotalCount"`
			Active      string `json:"Active"`
			Size        string `json:"Size"`
			Reclaimable string `json:"Reclaimable"`
		}
		if json.Unmarshal([]byte(line), &raw) != nil {
			continue
		}
		tc, _ := strconv.Atoi(raw.TotalCount)
		ac, _ := strconv.Atoi(raw.Active)
		rb, pct := parseReclaimable(raw.Reclaimable)
		sb := parseDockerSize(raw.Size)
		row := DockerDiskRow{
			Type:             raw.Type,
			TotalCount:       tc,
			Active:           ac,
			Size:             raw.Size,
			SizeBytes:        sb,
			Reclaimable:      raw.Reclaimable,
			ReclaimableBytes: rb,
			ReclaimablePct:   pct,
		}
		inv.Disk = append(inv.Disk, row)
		switch raw.Type {
		case "Images", "Containers", "Local Volumes", "Build Cache":
			inv.TotalBytes += sb
			inv.ReclaimBytes += rb
		}
	}

	imgOut, err := m.dockerQuiet(ctx, "images", "--format", "{{json .}}")
	if err != nil {
		return inv, fmt.Errorf("docker images: %w", err)
	}
	for _, line := range splitJSONLines(imgOut) {
		var raw struct {
			ID           string `json:"ID"`
			Repository   string `json:"Repository"`
			Tag          string `json:"Tag"`
			Size         string `json:"Size"`
			Containers   string `json:"Containers"`
			CreatedSince string `json:"CreatedSince"`
		}
		if json.Unmarshal([]byte(line), &raw) != nil {
			continue
		}
		n, _ := strconv.Atoi(raw.Containers)
		repo := raw.Repository
		tag := raw.Tag
		dangling := repo == "<none>" || tag == "<none>"
		ref := repo + ":" + tag
		if dangling {
			ref = raw.ID
		}
		inv.Images = append(inv.Images, DockerImage{
			ID:           raw.ID,
			Repository:   repo,
			Tag:          tag,
			Ref:          ref,
			Size:         raw.Size,
			SizeBytes:    parseDockerSize(raw.Size),
			Containers:   n,
			CreatedSince: raw.CreatedSince,
			Dangling:     dangling,
			InUse:        n > 0,
		})
	}
	sort.Slice(inv.Images, func(i, j int) bool {
		if inv.Images[i].SizeBytes == inv.Images[j].SizeBytes {
			return inv.Images[i].Ref < inv.Images[j].Ref
		}
		return inv.Images[i].SizeBytes > inv.Images[j].SizeBytes
	})

	ctrOut, err := m.dockerQuiet(ctx, "ps", "-a", "--format", "{{json .}}")
	if err != nil {
		return inv, fmt.Errorf("docker ps: %w", err)
	}
	usedVols := map[string]bool{}
	for _, line := range splitJSONLines(ctrOut) {
		var raw struct {
			ID     string `json:"ID"`
			Names  string `json:"Names"`
			Image  string `json:"Image"`
			State  string `json:"State"`
			Status string `json:"Status"`
			Size   string `json:"Size"`
			Labels string `json:"Labels"`
			Mounts string `json:"Mounts"`
		}
		if json.Unmarshal([]byte(line), &raw) != nil {
			continue
		}
		name := strings.TrimPrefix(raw.Names, "/")
		if i := strings.IndexByte(name, ','); i >= 0 {
			name = name[:i]
		}
		project := labelValue(raw.Labels, "com.docker.compose.project")
		fwGroup := labelValue(raw.Labels, labelGroup)
		fwService := labelValue(raw.Labels, labelService)
		fwRole := labelValue(raw.Labels, labelRole)
		managed := labelValue(raw.Labels, labelManaged) == "1" ||
			strings.HasPrefix(name, "fw-") ||
			strings.HasPrefix(name, "fw-build-") ||
			strings.HasPrefix(name, "firewifi-") ||
			project == "infra" ||
			strings.Contains(name, "firewifi")
		running := strings.EqualFold(raw.State, "running")
		inv.Containers = append(inv.Containers, DockerContainer{
			ID:      raw.ID,
			Name:    name,
			Image:   raw.Image,
			State:   raw.State,
			Status:  raw.Status,
			Size:    raw.Size,
			Running: running,
			Managed: managed,
			Group:   fwGroup,
			Service: fwService,
			Role:    fwRole,
			Project: project,
		})
		for _, part := range strings.Split(raw.Mounts, ",") {
			part = strings.TrimSpace(part)
			if part != "" && !strings.HasPrefix(part, "/") {
				usedVols[part] = true
			}
		}
	}
	sort.Slice(inv.Containers, func(i, j int) bool {
		if inv.Containers[i].Running != inv.Containers[j].Running {
			return inv.Containers[i].Running
		}
		return inv.Containers[i].Name < inv.Containers[j].Name
	})

	volSizes := m.volumeSizes(ctx)
	volOut, err := m.dockerQuiet(ctx, "volume", "ls", "--format", "{{json .}}")
	if err != nil {
		return inv, fmt.Errorf("docker volume ls: %w", err)
	}
	for _, line := range splitJSONLines(volOut) {
		var raw struct {
			Name       string `json:"Name"`
			Driver     string `json:"Driver"`
			Mountpoint string `json:"Mountpoint"`
		}
		if json.Unmarshal([]byte(line), &raw) != nil {
			continue
		}
		sz := volSizes[raw.Name]
		inUse := false
		for k := range usedVols {
			if k == raw.Name || strings.HasPrefix(raw.Name, k) || strings.HasPrefix(k, raw.Name) {
				inUse = true
				break
			}
		}
		if !inUse {
			inUse = volumeInUse(ctx, m, raw.Name)
		}
		inv.Volumes = append(inv.Volumes, DockerVolume{
			Name:       raw.Name,
			Driver:     raw.Driver,
			Size:       sz.Human,
			SizeBytes:  sz.Bytes,
			InUse:      inUse,
			Mountpoint: raw.Mountpoint,
		})
	}
	sort.Slice(inv.Volumes, func(i, j int) bool {
		if inv.Volumes[i].SizeBytes == inv.Volumes[j].SizeBytes {
			return inv.Volumes[i].Name < inv.Volumes[j].Name
		}
		return inv.Volumes[i].SizeBytes > inv.Volumes[j].SizeBytes
	})

	return inv, nil
}

type volSize struct {
	Human string
	Bytes int64
}

func (m *Manager) volumeSizes(ctx context.Context) map[string]volSize {
	out := map[string]volSize{}
	raw, err := m.dockerQuiet(ctx, "system", "df", "-v")
	if err != nil {
		return out
	}
	inVols := false
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "Local Volumes space usage:") {
			inVols = true
			continue
		}
		if inVols && (strings.HasPrefix(line, "Build cache") || strings.HasPrefix(line, "Build Cache")) {
			break
		}
		if !inVols {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 || fields[0] == "VOLUME" {
			continue
		}
		size := fields[len(fields)-1]
		name := strings.Join(fields[:len(fields)-2], " ")
		if name == "" {
			continue
		}
		out[name] = volSize{Human: size, Bytes: parseDockerSize(size)}
	}
	return out
}

func volumeInUse(ctx context.Context, m *Manager, name string) bool {
	out, err := m.dockerQuiet(ctx, "ps", "-a", "--filter", "volume="+name, "--format", "{{.ID}}")
	return err == nil && strings.TrimSpace(out) != ""
}

func labelValue(labels, key string) string {
	for _, part := range strings.Split(labels, ",") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) == 2 && kv[0] == key {
			return kv[1]
		}
	}
	return ""
}

func splitJSONLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		out = append(out, line)
	}
	return out
}

// DockerDo runs a housekeeping action.
func (m *Manager) DockerDo(ctx context.Context, act DockerAction) (DockerActionResult, error) {
	res := DockerActionResult{Action: act.Action}
	switch strings.ToLower(strings.TrimSpace(act.Action)) {
	case "daemon_start", "daemon-start":
		st, err := m.StartDockerDaemon(ctx)
		if err != nil {
			return res, err
		}
		res.OK = true
		res.Message = "Docker daemon running"
		if st.Version != "" {
			res.Message += " · " + st.Version
		}
		return res, nil

	case "daemon_stop", "daemon-stop":
		_, err := m.StopDockerDaemon(ctx)
		if err != nil {
			return res, err
		}
		res.OK = true
		res.Message = "Docker daemon stopped"
		return res, nil

	case "start":
		id := strings.TrimSpace(act.ID)
		if id == "" {
			return res, fmt.Errorf("id required")
		}
		out, err := m.dockerQuiet(ctx, "start", id)
		if err != nil {
			return res, err
		}
		res.OK = true
		res.Message = "Started " + id
		res.Output = out
		return res, nil

	case "stop":
		id := strings.TrimSpace(act.ID)
		if id == "" {
			return res, fmt.Errorf("id required")
		}
		out, err := m.dockerQuiet(ctx, "stop", id)
		if err != nil {
			return res, err
		}
		res.OK = true
		res.Message = "Stopped " + id
		res.Output = out
		return res, nil

	case "rm-container", "remove-container":
		id := strings.TrimSpace(act.ID)
		if id == "" {
			return res, fmt.Errorf("id required")
		}
		args := []string{"rm"}
		if act.Force {
			args = append(args, "-f")
		}
		args = append(args, id)
		out, err := m.dockerQuiet(ctx, args...)
		if err != nil {
			return res, err
		}
		res.OK = true
		res.Message = "Removed container " + id
		res.Output = out
		return res, nil

	case "rm-image", "remove-image":
		id := strings.TrimSpace(act.ID)
		if id == "" {
			return res, fmt.Errorf("id required")
		}
		args := []string{"rmi"}
		if act.Force {
			args = append(args, "-f")
		}
		args = append(args, id)
		out, err := m.dockerQuiet(ctx, args...)
		if err != nil {
			return res, err
		}
		res.OK = true
		res.Message = "Removed image " + id
		res.Output = out
		return res, nil

	case "rm-volume", "remove-volume":
		id := strings.TrimSpace(act.ID)
		if id == "" {
			return res, fmt.Errorf("id required")
		}
		args := []string{"volume", "rm"}
		if act.Force {
			args = append(args, "-f")
		}
		args = append(args, id)
		out, err := m.dockerQuiet(ctx, args...)
		if err != nil {
			return res, err
		}
		res.OK = true
		res.Message = "Removed volume " + id
		res.Output = out
		return res, nil

	case "stop-all":
		// Scoped: only FireWifi-managed containers (labels or fw- name prefix).
		ids := m.listManagedRunningIDs(ctx)
		if len(ids) == 0 {
			res.OK = true
			res.Message = "No managed containers running"
			return res, nil
		}
		args := append([]string{"stop"}, ids...)
		sout, err := m.dockerQuiet(ctx, args...)
		if err != nil {
			return res, err
		}
		res.OK = true
		res.Message = fmt.Sprintf("Stopped %d managed container(s)", len(ids))
		res.Output = sout
		return res, nil

	case "prune":
		var msgs []string
		var outs []string
		run := func(label string, args ...string) error {
			o, err := m.dockerQuiet(ctx, args...)
			if err != nil {
				return fmt.Errorf("%s: %w", label, err)
			}
			if strings.TrimSpace(o) != "" {
				outs = append(outs, o)
			}
			msgs = append(msgs, label)
			return nil
		}
		if act.Containers {
			if err := run("stopped containers", "container", "prune", "-f"); err != nil {
				return res, err
			}
		}
		if act.Images {
			args := []string{"image", "prune", "-f"}
			if act.AllUnused {
				args = append(args, "-a")
			}
			label := "dangling images"
			if act.AllUnused {
				label = "unused images"
			}
			if err := run(label, args...); err != nil {
				return res, err
			}
		}
		if act.Volumes {
			if err := run("unused volumes", "volume", "prune", "-f"); err != nil {
				return res, err
			}
		}
		if act.BuildCache {
			if err := run("build cache", "builder", "prune", "-af"); err != nil {
				_ = run("build cache", "buildx", "prune", "-af")
			}
		}
		if len(msgs) == 0 {
			return res, fmt.Errorf("select at least one prune target")
		}
		res.OK = true
		res.Message = "Pruned: " + strings.Join(msgs, ", ")
		res.Output = strings.Join(outs, "\n")
		return res, nil

	default:
		return res, fmt.Errorf("unknown action %q", act.Action)
	}
}

// listManagedRunningIDs returns IDs of running FireWifi-managed containers.
// The shared Postgres engine is excluded — control it from Storage → Engine.
func (m *Manager) listManagedRunningIDs(ctx context.Context) []string {
	seen := map[string]bool{}
	var ids []string
	add := func(id, name string) {
		id = strings.TrimSpace(id)
		name = strings.TrimPrefix(strings.TrimSpace(name), "/")
		if id == "" || seen[id] {
			return
		}
		// Shared engine lives under firewifi-postgres / infra compose — not an app container.
		if name == "firewifi-postgres" || strings.HasPrefix(name, "firewifi-postgres") {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if out, err := m.dockerQuiet(ctx, "ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Label \"firewifi.managed\"}}\t{{.Label \"com.docker.compose.project\"}}"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			parts := strings.Split(line, "\t")
			if len(parts) < 2 {
				continue
			}
			id, name := parts[0], parts[1]
			managed := len(parts) > 2 && parts[2] == "1"
			project := ""
			if len(parts) > 3 {
				project = parts[3]
			}
			if project == "infra" && (name == "firewifi-postgres" || strings.Contains(name, "postgres")) {
				continue
			}
			if managed || strings.HasPrefix(name, "fw-") || strings.HasPrefix(name, "fw-build-") || strings.HasPrefix(name, "firewifi-") {
				add(id, name)
			}
		}
	}
	return ids
}

