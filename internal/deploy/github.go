package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

var ghHTTP = &http.Client{
	Timeout: 20 * time.Second,
	Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "firewifi-dashboard")
	resp, err := ghHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github %s failed (%d)", url, resp.StatusCode)
	}
	return body, nil
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

func (m *Manager) ListDirs(ctx context.Context, repo, branch, path string) ([]GitHubDir, error) {
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
	norm, err := normalizeRootDir(path)
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
	}
	if err := json.Unmarshal(body, &batch); err != nil {
		// GitHub returns object when path is a file
		return nil, fmt.Errorf("not a directory")
	}
	out := make([]GitHubDir, 0, len(batch))
	for _, e := range batch {
		if e.Type != "dir" {
			continue
		}
		out = append(out, GitHubDir{Name: e.Name, Path: e.Path})
	}
	sort.SliceStable(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}
