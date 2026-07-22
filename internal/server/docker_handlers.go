package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"firewifi/dashboard/internal/deploy"
)

func (s *Server) handleManage(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ov, err := s.Deploy.ManageOverview(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	jsonReply(w, ov)
}

func (s *Server) handleDocker(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	switch {
	case r.URL.Path == "/api/docker" && r.Method == http.MethodGet:
		inv, err := s.Deploy.DockerInventory(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, inv)
	case r.URL.Path == "/api/docker" && r.Method == http.MethodPost:
		var act deploy.DockerAction
		if err := json.NewDecoder(r.Body).Decode(&act); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		res, err := s.Deploy.DockerDo(r.Context(), act)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, res)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleEngine(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	switch r.Method {
	case http.MethodGet:
		jsonReply(w, s.Deploy.EngineView(r.Context()))
	case http.MethodPut, http.MethodPost:
		var body struct {
			Action          string `json:"action"`
			PostgresVersion string `json:"postgres_version"`
			GoToolchain     string `json:"go_toolchain"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		action := strings.ToLower(strings.TrimSpace(body.Action))
		switch action {
		case "start":
			view, err := s.Deploy.StartPostgresEngine(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, view)
			return
		case "stop":
			view, err := s.Deploy.StopPostgresEngine(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, view)
			return
		case "", "update":
			view, err := s.Deploy.UpdateEngine(r.Context(), deploy.EngineSettings{
				PostgresVersion: body.PostgresVersion,
				GoToolchain:     body.GoToolchain,
			})
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, view)
			return
		default:
			http.Error(w, "unknown action", http.StatusBadRequest)
			return
		}
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
