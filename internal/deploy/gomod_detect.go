package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// GoModuleRoot is a directory that contains a go.mod ("" = repository root).
type GoModuleRoot struct {
	Path     string `json:"path"`
	HasGoMod bool   `json:"has_go_mod"`
}

// GoRootDetect is returned with /api/github/dirs for transparent monorepo picking.
type GoRootDetect struct {
	Modules       []GoModuleRoot `json:"go_modules"`
	RootHasGoMod  bool           `json:"root_has_go_mod"`
	SuggestedRoot string         `json:"suggested_root"`
	SuggestReason string         `json:"suggest_reason"`
}

var preferredGoRoots = []string{
	"backend", "api", "server", "cmd", "app", "go", "service", "services", "internal",
}

// DetectGoModuleRoots finds go.mod files via the GitHub git tree API (recursive).
func (m *Manager) DetectGoModuleRoots(ctx context.Context, repo, branch string) (GoRootDetect, error) {
	out := GoRootDetect{Modules: []GoModuleRoot{}}
	repo = normalizeRepo(repo)
	if repo == "" {
		return out, fmt.Errorf("repo required as owner/name")
	}
	token, err := m.readToken()
	if err != nil {
		return out, err
	}
	if token == "" {
		return out, fmt.Errorf("github not connected")
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "main"
	}

	paths, truncated, err := m.listGoModPaths(ctx, repo, branch, token)
	if err != nil {
		return out, err
	}
	if truncated && len(paths) == 0 {
		paths, _ = m.probeTopLevelGoMods(ctx, repo, branch, token)
	}

	seen := map[string]bool{}
	rootHas := false
	var mods []GoModuleRoot
	for _, p := range paths {
		dir := goModDir(p)
		norm, nerr := normalizeRootDir(dir)
		if nerr != nil {
			continue
		}
		if seen[norm] {
			continue
		}
		seen[norm] = true
		if norm == "" {
			rootHas = true
		}
		mods = append(mods, GoModuleRoot{Path: norm, HasGoMod: true})
	}
	sort.SliceStable(mods, func(i, j int) bool {
		if (mods[i].Path == "") != (mods[j].Path == "") {
			return mods[i].Path == ""
		}
		return strings.ToLower(mods[i].Path) < strings.ToLower(mods[j].Path)
	})
	if !rootHas {
		mods = append([]GoModuleRoot{{Path: "", HasGoMod: false}}, mods...)
	}
	out.Modules = mods
	out.RootHasGoMod = rootHas
	out.SuggestedRoot, out.SuggestReason = suggestGoRoot(mods, rootHas)
	return out, nil
}

func goModDir(path string) string {
	path = strings.Trim(strings.ReplaceAll(path, "\\", "/"), "/")
	if path == "go.mod" {
		return ""
	}
	if strings.HasSuffix(path, "/go.mod") {
		return strings.TrimSuffix(path, "/go.mod")
	}
	return path
}

func (m *Manager) listGoModPaths(ctx context.Context, repo, branch, token string) ([]string, bool, error) {
	u := "https://api.github.com/repos/" + repo + "/git/trees/" + url.PathEscape(branch) + "?recursive=1"
	body, err := m.ghGET(ctx, u, token)
	if err != nil {
		return nil, false, err
	}
	var tree struct {
		Truncated bool `json:"truncated"`
		Tree      []struct {
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"tree"`
	}
	if err := json.Unmarshal(body, &tree); err != nil {
		return nil, false, err
	}
	var paths []string
	for _, e := range tree.Tree {
		if e.Type != "blob" {
			continue
		}
		if e.Path == "go.mod" || strings.HasSuffix(e.Path, "/go.mod") {
			paths = append(paths, e.Path)
		}
	}
	return paths, tree.Truncated, nil
}

func (m *Manager) probeTopLevelGoMods(ctx context.Context, repo, branch, token string) ([]string, error) {
	var paths []string
	if m.githubFileExists(ctx, repo, branch, "go.mod", token) {
		paths = append(paths, "go.mod")
	}
	dirs, err := m.ListDirs(ctx, repo, branch, "")
	if err != nil {
		return paths, err
	}
	for _, d := range dirs {
		if d.Name == "vendor" || d.Name == "node_modules" || d.Name == ".git" {
			continue
		}
		modPath := strings.Trim(d.Path, "/") + "/go.mod"
		if m.githubFileExists(ctx, repo, branch, modPath, token) {
			paths = append(paths, modPath)
		}
	}
	return paths, nil
}

func (m *Manager) githubFileExists(ctx context.Context, repo, branch, path, token string) bool {
	path = strings.Trim(path, "/")
	u := "https://api.github.com/repos/" + repo + "/contents/" + path + "?ref=" + url.QueryEscape(branch)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "firewifi-dashboard")
	resp, err := ghHTTP.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode == http.StatusOK
}

func suggestGoRoot(mods []GoModuleRoot, rootHas bool) (suggested, reason string) {
	if rootHas {
		return "", "go.mod at repository root"
	}
	var withMod []string
	for _, m := range mods {
		if m.Path != "" && m.HasGoMod {
			withMod = append(withMod, m.Path)
		}
	}
	if len(withMod) == 0 {
		return "", "No go.mod found — pick a folder or type a path"
	}
	if len(withMod) == 1 {
		return withMod[0], "Detected go.mod in " + withMod[0] + "/"
	}
	for _, pref := range preferredGoRoots {
		for _, p := range withMod {
			if p == pref || strings.HasSuffix(p, "/"+pref) {
				return p, "Detected go.mod in " + p + "/ (common monorepo path)"
			}
		}
	}
	return withMod[0], "Multiple go.mod — suggested " + withMod[0] + "/ (override anytime)"
}

// suggestLocalGoRoot scans a cloned repo when RootDir was left empty and root has no go.mod.
func suggestLocalGoRoot(repoDir string) (root, reason string) {
	var found []string
	_ = filepath.Walk(repoDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil {
			return nil
		}
		name := info.Name()
		if info.IsDir() {
			if name == ".git" || name == "vendor" || name == "node_modules" || name == ".firewifi" {
				return filepath.SkipDir
			}
			rel, _ := filepath.Rel(repoDir, path)
			depth := 0
			if rel != "." && rel != "" {
				depth = strings.Count(rel, string(filepath.Separator)) + 1
			}
			if depth > 3 {
				return filepath.SkipDir
			}
			return nil
		}
		if name != "go.mod" {
			return nil
		}
		dir := filepath.Dir(path)
		rel, err := filepath.Rel(repoDir, dir)
		if err != nil {
			return nil
		}
		if rel == "." {
			found = append(found, "")
			return nil
		}
		rel = filepath.ToSlash(rel)
		if strings.HasPrefix(rel, "..") {
			return nil
		}
		found = append(found, rel)
		return nil
	})
	rootHas := false
	mods := make([]GoModuleRoot, 0, len(found))
	seen := map[string]bool{}
	for _, p := range found {
		if seen[p] {
			continue
		}
		seen[p] = true
		if p == "" {
			rootHas = true
		}
		mods = append(mods, GoModuleRoot{Path: p, HasGoMod: true})
	}
	return suggestGoRoot(mods, rootHas)
}
