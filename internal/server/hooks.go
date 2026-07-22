package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"firewifi/dashboard/internal/deploy"
)

func (s *Server) handleDeployHooks(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	path := strings.TrimSuffix(r.URL.Path, "/")
	switch {
	case strings.HasSuffix(path, "/hooks/redeploy") && r.Method == http.MethodPost:
		if err := s.Deploy.ValidateDeployToken(r); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var body deploy.HookRedeployRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		list, err := s.Deploy.RedeployFromHook(r.Context(), body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]any{"redeployed": list})

	case strings.HasSuffix(path, "/hooks/github") && r.Method == http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		if event := r.Header.Get("X-GitHub-Event"); event != "" && event != "push" {
			jsonReply(w, map[string]string{"status": "ignored", "event": event})
			return
		}
		list, err := s.Deploy.HandleGitHubPush(r.Context(), body, r.Header.Get("X-Hub-Signature-256"))
		if err != nil {
			if errors.Is(err, deploy.ErrUnauthorized) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]any{"redeployed": list})

	default:
		http.NotFound(w, r)
	}
}
