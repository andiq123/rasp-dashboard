package deploy

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const githubPreviewMax = 256 << 10 // 256 KiB decoded text

var ghHTTP = &http.Client{
	Timeout: 20 * time.Second,
	Transport: &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		TLSHandshakeTimeout: 5 * time.Second,
	},
}

type GitHubUser struct {
	Login string `json:"login"`
	Name  string `json:"name"`
}

type GitHubRepo struct {
	FullName    string `json:"full_name"`
	Name        string `json:"name"`
	Private     bool   `json:"private"`
	DefaultBr   string `json:"default_branch"`
	Description string `json:"description"`
	Language    string `json:"language"`
}

type GitHubBranch struct {
	Name      string `json:"name"`
	Protected bool   `json:"protected"`
	Default   bool   `json:"default,omitempty"`
}

type GitHubDir struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// GitHubEntry is a directory or file from the Contents API.
type GitHubEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"` // dir|file
	Size int64  `json:"size,omitempty"`
}

// GitHubFilePreview mirrors local files preview for remote GitHub files.
type GitHubFilePreview struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Text      string `json:"text,omitempty"`
	Binary    bool   `json:"binary,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	Error     string `json:"error,omitempty"`
}

func (m *Manager) SaveToken(ctx context.Context, token string) (GitHubUser, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return GitHubUser{}, fmt.Errorf("token required")
	}
	if err := m.acquireJob("Connect GitHub", "github"); err != nil {
		return GitHubUser{}, err
	}
	m.startProgress(GitHubConnectSteps())
	m.stepProgress("verify")
	m.logf("step", "Verifying token with GitHub API")
	user, err := m.verifyToken(ctx, token)
	if err != nil {
		m.releaseJob(false, err.Error())
		return GitHubUser{}, err
	}
	m.logf("ok", "Authenticated as %s", user.Login)
	m.stepProgress("save")
	m.logf("info", "Writing token to Pi")
	if err := m.ensureDirs(); err != nil {
		m.releaseJob(false, err.Error())
		return GitHubUser{}, err
	}
	if err := os.WriteFile(m.TokenPath, []byte(token+"\n"), 0o600); err != nil {
		m.releaseJob(false, err.Error())
		return GitHubUser{}, err
	}
	m.releaseJob(true, "GitHub connected · "+user.Login)
	return user, nil
}

func (m *Manager) ClearToken() error {
	_ = os.Remove(m.TokenPath)
	return nil
}

func (m *Manager) GitHubStatus(ctx context.Context) (bool, GitHubUser, error) {
	token, err := m.readToken()
	if err != nil || token == "" {
		return false, GitHubUser{}, nil
	}
	user, err := m.verifyToken(ctx, token)
	if err != nil {
		return false, GitHubUser{}, err
	}
	return true, user, nil
}

func (m *Manager) readToken() (string, error) {
	b, err := os.ReadFile(m.TokenPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

func (m *Manager) verifyToken(ctx context.Context, token string) (GitHubUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return GitHubUser{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "firewifi-dashboard")
	resp, err := ghHTTP.Do(req)
	if err != nil {
		return GitHubUser{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return GitHubUser{}, fmt.Errorf("github auth failed (%d)", resp.StatusCode)
	}
	var u GitHubUser
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return GitHubUser{}, err
	}
	return u, nil
}

func (m *Manager) ghGET(ctx context.Context, url string, token string) ([]byte, error) {
	body, code, err := m.ghDo(ctx, http.MethodGet, url, token, nil)
	if err != nil {
		return nil, err
	}
	if code != http.StatusOK {
		return nil, fmt.Errorf("github %s failed (%d)", url, code)
	}
	return body, nil
}

func (m *Manager) ghDo(ctx context.Context, method, url, token string, payload any) ([]byte, int, error) {
	var bodyReader io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return nil, 0, err
		}
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "firewifi-dashboard")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := ghHTTP.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func (m *Manager) ListRepos(ctx context.Context) ([]GitHubRepo, error) {
	token, err := m.readToken()
	if err != nil {
		return nil, err
	}
	if token == "" {
		return nil, fmt.Errorf("github not connected")
	}
	var all []GitHubRepo
	for page := 1; page <= 5; page++ {
		body, err := m.ghGET(ctx, fmt.Sprintf("https://api.github.com/user/repos?per_page=100&page=%d&sort=updated&affiliation=owner,collaborator,organization_member", page), token)
		if err != nil {
			return nil, err
		}
		var batch []struct {
			FullName      string `json:"full_name"`
			Name          string `json:"name"`
			Private       bool   `json:"private"`
			DefaultBranch string `json:"default_branch"`
			Description   string `json:"description"`
			Language      string `json:"language"`
		}
		if err := json.Unmarshal(body, &batch); err != nil {
			return nil, err
		}
		if len(batch) == 0 {
			break
		}
		for _, r := range batch {
			all = append(all, GitHubRepo{
				FullName: r.FullName, Name: r.Name, Private: r.Private,
				DefaultBr: r.DefaultBranch, Description: r.Description, Language: r.Language,
			})
		}
		if len(batch) < 100 {
			break
		}
	}
	sort.Slice(all, func(i, j int) bool {
		gi, gj := strings.EqualFold(all[i].Language, "Go"), strings.EqualFold(all[j].Language, "Go")
		if gi != gj {
			return gi
		}
		return strings.ToLower(all[i].FullName) < strings.ToLower(all[j].FullName)
	})
	return all, nil
}

func (m *Manager) ListBranches(ctx context.Context, repo string) ([]GitHubBranch, error) {
	repo = normalizeRepo(repo)
	if repo == "" {
		return nil, fmt.Errorf("repo required as owner/name")
	}
	token, err := m.readToken()
	if err != nil {
		return nil, err
	}
	if token == "" {
		return nil, fmt.Errorf("github not connected")
	}
	defBr := "main"
	if body, err := m.ghGET(ctx, "https://api.github.com/repos/"+repo, token); err == nil {
		var meta struct {
			DefaultBranch string `json:"default_branch"`
		}
		if json.Unmarshal(body, &meta) == nil && meta.DefaultBranch != "" {
			defBr = meta.DefaultBranch
		}
	}
	var all []GitHubBranch
	for page := 1; page <= 10; page++ {
		body, err := m.ghGET(ctx, fmt.Sprintf("https://api.github.com/repos/%s/branches?per_page=100&page=%d", repo, page), token)
		if err != nil {
			return nil, err
		}
		var batch []struct {
			Name      string `json:"name"`
			Protected bool   `json:"protected"`
		}
		if err := json.Unmarshal(body, &batch); err != nil {
			return nil, err
		}
		if len(batch) == 0 {
			break
		}
		for _, b := range batch {
			all = append(all, GitHubBranch{Name: b.Name, Protected: b.Protected, Default: b.Name == defBr})
		}
		if len(batch) < 100 {
			break
		}
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].Default != all[j].Default {
			return all[i].Default
		}
		return strings.ToLower(all[i].Name) < strings.ToLower(all[j].Name)
	})
	return all, nil
}

func (m *Manager) ListDirs(ctx context.Context, repo, branch, dirPath string) ([]GitHubDir, error) {
	entries, err := m.ListContents(ctx, repo, branch, dirPath)
	if err != nil {
		return nil, err
	}
	out := make([]GitHubDir, 0, len(entries))
	for _, e := range entries {
		if e.Type != "dir" {
			continue
		}
		out = append(out, GitHubDir{Name: e.Name, Path: e.Path})
	}
	return out, nil
}

func (m *Manager) ListContents(ctx context.Context, repo, branch, dirPath string) ([]GitHubEntry, error) {
	repo = normalizeRepo(repo)
	if repo == "" {
		return nil, fmt.Errorf("repo required as owner/name")
	}
	token, err := m.readToken()
	if err != nil {
		return nil, err
	}
	if token == "" {
		return nil, fmt.Errorf("github not connected")
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "main"
	}
	norm, err := normalizeRootDir(dirPath)
	if err != nil {
		return nil, err
	}
	url := "https://api.github.com/repos/" + repo + "/contents"
	if norm != "" {
		url += "/" + norm
	}
	url += "?ref=" + strings.ReplaceAll(branch, " ", "%20")
	body, err := m.ghGET(ctx, url, token)
	if err != nil {
		return nil, err
	}
	var batch []struct {
		Name string `json:"name"`
		Path string `json:"path"`
		Type string `json:"type"`
		Size int64  `json:"size"`
	}
	if err := json.Unmarshal(body, &batch); err != nil {
		return nil, fmt.Errorf("not a directory")
	}
	out := make([]GitHubEntry, 0, len(batch))
	for _, e := range batch {
		t := e.Type
		if t != "dir" && t != "file" {
			continue
		}
		out = append(out, GitHubEntry{Name: e.Name, Path: e.Path, Type: t, Size: e.Size})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type == "dir"
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func (m *Manager) GetFilePreview(ctx context.Context, repo, branch, filePath string) (GitHubFilePreview, error) {
	repo = normalizeRepo(repo)
	if repo == "" {
		return GitHubFilePreview{}, fmt.Errorf("repo required as owner/name")
	}
	norm, err := normalizeRootDir(filePath)
	if err != nil || norm == "" {
		return GitHubFilePreview{}, fmt.Errorf("file path required")
	}
	token, err := m.readToken()
	if err != nil {
		return GitHubFilePreview{}, err
	}
	if token == "" {
		return GitHubFilePreview{}, fmt.Errorf("github not connected")
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "main"
	}
	url := "https://api.github.com/repos/" + repo + "/contents/" + norm + "?ref=" + strings.ReplaceAll(branch, " ", "%20")
	body, err := m.ghGET(ctx, url, token)
	if err != nil {
		return GitHubFilePreview{}, err
	}
	var obj struct {
		Type     string `json:"type"`
		Name     string `json:"name"`
		Path     string `json:"path"`
		Size     int64  `json:"size"`
		Encoding string `json:"encoding"`
		Content  string `json:"content"`
	}
	if err := json.Unmarshal(body, &obj); err != nil {
		return GitHubFilePreview{}, fmt.Errorf("not a file")
	}
	out := GitHubFilePreview{
		Path: obj.Path,
		Name: obj.Name,
		Size: obj.Size,
	}
	if out.Name == "" {
		out.Name = path.Base(norm)
	}
	if out.Path == "" {
		out.Path = norm
	}
	if obj.Type != "file" {
		out.Error = "not a file"
		return out, nil
	}
	if obj.Content == "" || obj.Encoding != "base64" {
		if obj.Size > githubPreviewMax {
			out.Truncated = true
			out.Error = "file too large to preview"
			return out, nil
		}
		out.Binary = true
		out.Error = "binary file — preview unavailable"
		return out, nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(obj.Content, "\n", ""))
	if err != nil {
		out.Binary = true
		out.Error = "could not decode file"
		return out, nil
	}
	if int64(len(raw)) > githubPreviewMax {
		raw = raw[:githubPreviewMax]
		out.Truncated = true
	}
	if !utf8.Valid(raw) {
		out.Binary = true
		out.Error = "binary file — preview unavailable"
		return out, nil
	}
	out.Text = string(raw)
	return out, nil
}
