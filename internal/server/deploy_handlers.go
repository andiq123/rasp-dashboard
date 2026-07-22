package server

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"firewifi/dashboard/internal/deploy"
)

var pathSlug = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)

func badSlug(w http.ResponseWriter, label string) {
	http.Error(w, "invalid "+label, http.StatusBadRequest)
}



func (s *Server) handlePorts(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	audit, err := s.Deploy.AuditPorts(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	jsonReply(w, audit)
}

func (s *Server) handleGitHub(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	switch {
	case r.URL.Path == "/api/github/status" && r.Method == http.MethodGet:
		ok, user, err := s.Deploy.GitHubStatus(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]interface{}{"connected": ok, "user": user})
	case r.URL.Path == "/api/github/repos" && r.Method == http.MethodGet:
		repos, err := s.Deploy.ListRepos(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]interface{}{"repos": repos})
	case r.URL.Path == "/api/github/branches" && r.Method == http.MethodGet:
		branches, err := s.Deploy.ListBranches(r.Context(), r.URL.Query().Get("repo"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]interface{}{"branches": branches})
	case r.URL.Path == "/api/github/dirs" && r.Method == http.MethodGet:
		dirs, err := s.Deploy.ListDirs(r.Context(), r.URL.Query().Get("repo"), r.URL.Query().Get("branch"), r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]interface{}{"dirs": dirs})
	case r.URL.Path == "/api/github/token" && r.Method == http.MethodPost:
		var body struct {
			Token string `json:"token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		user, err := s.Deploy.SaveToken(r.Context(), body.Token)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]interface{}{"ok": true, "user": user})
	case r.URL.Path == "/api/github/token" && r.Method == http.MethodDelete:
		_ = s.Deploy.ClearToken()
		okReply(w)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleInfraPostgres(w http.ResponseWriter, r *http.Request) {
	if s.Postgres == nil {
		http.Error(w, "postgres not configured", http.StatusNotImplemented)
		return
	}
	switch {
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/status"):
		jsonReply(w, s.Postgres.Status(r.Context()))
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/start"):
		if err := s.Postgres.Start(r.Context()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		okReply(w)
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/stop"):
		if err := s.Postgres.Stop(r.Context()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		okReply(w)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleGroups(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/groups"), "/")
	parts := []string{}
	if path != "" {
		parts = strings.Split(path, "/")
	}

	// /api/groups
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			list, err := s.Deploy.ListGroups(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			jsonReply(w, map[string]interface{}{"groups": list})
		case http.MethodPost:
			var body deploy.CreateGroupRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			g, err := s.Deploy.CreateGroup(r.Context(), body.Name)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, g)
		default:
			methodNotAllowed(w)
		}
		return
	}

	group := parts[0]
	if !pathSlug.MatchString(group) {
		badSlug(w, "group")
		return
	}
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodDelete:
			if err := s.Deploy.DeleteGroup(r.Context(), group); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			okReply(w)
		case http.MethodPut, http.MethodPost:
			var body deploy.GroupSettingsUpdate
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			g, err := s.Deploy.UpdateGroup(r.Context(), group, body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, g)
		default:
			methodNotAllowed(w)
		}
		return
	}

	if parts[1] == "stats" && len(parts) == 2 {
		if r.Method != http.MethodGet {
			methodNotAllowed(w)
			return
		}
		jsonReply(w, map[string]interface{}{"stats": s.Deploy.ListGroupStats(group)})
		return
	}

	if parts[1] == "env" && len(parts) == 2 {
		switch r.Method {
		case http.MethodGet:
			text, js, err := s.Deploy.GetGroupEnv(group)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, map[string]string{"env": text, "env_json": js})
		case http.MethodPut, http.MethodPost:
			var body struct {
				Env string `json:"env"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			g, err := s.Deploy.UpdateGroup(r.Context(), group, deploy.GroupSettingsUpdate{Env: &body.Env})
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, g)
		default:
			methodNotAllowed(w)
		}
		return
	}

	if parts[1] != "services" {
		http.NotFound(w, r)
		return
	}

	// /api/groups/{g}/services
	if len(parts) == 2 {
		switch r.Method {
		case http.MethodGet:
			list, err := s.Deploy.ListServices(r.Context(), group)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			jsonReply(w, map[string]interface{}{"services": list})
		case http.MethodPost:
			var body struct {
				Type           string  `json:"type"`
				Name           string  `json:"name"`
				Repo           string  `json:"repo"`
				Branch         string  `json:"branch"`
				LinkedDatabase string  `json:"linked_database"`
				RootDir        string  `json:"root_dir"`
				BuildCmd       string  `json:"build_cmd"`
				GoToolchain    string  `json:"go_toolchain"`
				Version        string  `json:"version"`
				MemoryMB       int     `json:"memory_mb"`
				CPUs         float64 `json:"cpus"`
				Env            string  `json:"env"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "bad json", http.StatusBadRequest)
				return
			}
			switch body.Type {
			case deploy.TypePostgres:
				svc, err := s.Deploy.CreatePostgres(r.Context(), group, body.Name, body.Version)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				jsonReply(w, svc)
			case deploy.TypeGo, "":
				svc, err := s.Deploy.CreateGo(r.Context(), group, deploy.CreateGoRequest{
					Repo: body.Repo, Branch: body.Branch, Name: body.Name,
					LinkedDatabase: body.LinkedDatabase, RootDir: body.RootDir, BuildCmd: body.BuildCmd,
					GoToolchain: body.GoToolchain, MemoryMB: body.MemoryMB, CPUs: body.CPUs,
					Env: body.Env,
				})
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				jsonReply(w, svc)
			default:
				http.Error(w, "type must be go or postgres", http.StatusBadRequest)
			}
		default:
			methodNotAllowed(w)
		}
		return
	}

	slug := parts[2]
	if !pathSlug.MatchString(slug) {
		badSlug(w, "service")
		return
	}
	action := ""
	if len(parts) > 3 {
		action = parts[3]
	}

	switch {
	case action == "" && r.Method == http.MethodGet:
		svc, err := s.Deploy.Get(group, slug)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		jsonReply(w, svc)
	case action == "" && r.Method == http.MethodDelete:
		if err := s.Deploy.Delete(r.Context(), group, slug); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		okReply(w)
	case action == "logs" && r.Method == http.MethodGet:
		lines := 80
		if v := r.URL.Query().Get("lines"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				lines = n
			}
		}
		text, err := s.Deploy.TailContainerLogs(r.Context(), group, slug, lines)
		if err != nil && text == "" {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		st := map[string]interface{}{"group": group, "slug": slug, "logs": text}
		jsonReply(w, st)
	case action == "start" && r.Method == http.MethodPost:
		if err := s.Deploy.Start(r.Context(), group, slug); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		okReply(w)
	case action == "stop" && r.Method == http.MethodPost:
		if err := s.Deploy.Stop(r.Context(), group, slug); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		okReply(w)
	case action == "restart" && r.Method == http.MethodPost:
		if err := s.Deploy.Restart(r.Context(), group, slug); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		okReply(w)
	case action == "tunnel" && r.Method == http.MethodPost:
		svc, err := s.Deploy.StartTunnel(r.Context(), group, slug)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, svc)
	case action == "tunnel" && r.Method == http.MethodDelete:
		svc, err := s.Deploy.StopTunnel(r.Context(), group, slug)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, svc)
	case action == "query" && r.Method == http.MethodPost:
		var body struct {
			SQL string `json:"sql"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		res, err := s.Deploy.QueryDatabase(r.Context(), group, slug, body.SQL)
		if err != nil {
			msg := err.Error()
			if strings.Contains(msg, "cancelled") || r.Context().Err() != nil {
				http.Error(w, "cancelled", 499)
				return
			}
			http.Error(w, msg, http.StatusBadRequest)
			return
		}
		jsonReply(w, res)
	case action == "deployments" && len(parts) >= 6 && parts[5] == "logs" && r.Method == http.MethodGet:
		deployID := parts[4]
		if !strings.HasPrefix(deployID, "dpl_") {
			http.Error(w, "invalid deployment id", http.StatusBadRequest)
			return
		}
		lines, err := s.Deploy.ReadDeployLogs(group, slug, deployID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if lines == nil {
			lines = []deploy.ActivityLine{}
		}
		jsonReply(w, map[string]interface{}{
			"group": group, "slug": slug, "deployment_id": deployID, "lines": lines,
		})
	case action == "deployments" && r.Method == http.MethodGet:
		list, err := s.Deploy.ListDeployments(group, slug, 0)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]interface{}{"deployments": list})
	case action == "redeploy" && r.Method == http.MethodPost:
		svc, err := s.Deploy.Redeploy(r.Context(), group, slug)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, svc)
	case action == "env" && r.Method == http.MethodGet:
		text, js, err := s.Deploy.GetEnv(group, slug)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]string{"env": text, "env_json": js})
	case action == "settings" && (r.Method == http.MethodPut || r.Method == http.MethodPost):
		var body deploy.SettingsUpdate
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		svc, err := s.Deploy.UpdateSettings(r.Context(), group, slug, body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, svc)
	default:
		http.NotFound(w, r)
	}
}

// Legacy flat /api/services kept as convenience → requires ?group= or body.group
func (s *Server) handleServices(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	group := r.URL.Query().Get("group")
	if group == "" {
		group = "default"
	}
	// rewrite to groups handler path semantics via direct calls for GET list
	if strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/services"), "/") == "" && r.Method == http.MethodGet {
		list, err := s.Deploy.ListServices(r.Context(), group)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonReply(w, map[string]interface{}{"services": list})
		return
	}
	http.Error(w, "use /api/groups/{group}/services", http.StatusGone)
}
