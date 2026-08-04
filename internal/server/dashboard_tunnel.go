package server

import (
	"net/http"
	"strings"
)

func (s *Server) handleDashboardTunnel(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	switch r.Method {
	case http.MethodGet:
		jsonReply(w, s.Deploy.DashboardTunnelStatus())
	case http.MethodPost:
		var body struct {
			Mode          string `json:"mode"`
			Token         string `json:"token"`
			Hostname      string `json:"hostname"`
			AccessGuarded bool   `json:"access_guarded"`
		}
		if err := decodeJSONBody(r, &body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		status, err := s.Deploy.StartDashboardTunnel(r.Context(), strings.TrimSpace(body.Mode), body.Token, body.Hostname, body.AccessGuarded)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, status)
	case http.MethodDelete:
		jsonReply(w, s.Deploy.StopDashboardTunnel())
	default:
		methodNotAllowed(w)
	}
}
