package server

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"firewifi/dashboard/internal/alerts"
	"firewifi/dashboard/internal/state"
)

const alertInterval = 30 * time.Second

// watchAlerts turns the dashboard's own health checks into phone notifications.
func (s *Server) watchAlerts(ctx context.Context) {
	tick := time.NewTicker(alertInterval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			st, err := s.State.Read()
			if err != nil {
				continue
			}
			sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			s.Alerts.Evaluate(sendCtx, time.Now(), alertsFromState(st))
			cancel()
		}
	}
}

// alertsFromState maps current health to alerts. Outages wait two minutes so a
// self-healing blip (the VPN repair usually fixes itself) never pings the phone.
func alertsFromState(st state.State) []alerts.Alert {
	var out []alerts.Alert
	for _, is := range st.Issues {
		a := alerts.Alert{Key: is.Code, Title: is.Title, Body: is.Detail, Priority: "high", Tags: "warning", Grace: 2 * time.Minute}
		switch {
		case is.Code == "mullvad-expiring":
			a.Priority, a.Tags, a.Grace, a.NoResolve = "default", "hourglass", 0, true
		case strings.HasPrefix(is.Code, "app-crash:"):
			a.Tags, a.Grace = "boom", 0
		case is.Code == "temperature-high" || is.Code == "thermal-throttling":
			a.Tags, a.Grace = "thermometer", 5*time.Minute
		case is.Code == "uplink-offline" || strings.HasPrefix(is.Code, "vpn-") || is.Code == "hotspot-down":
			a.Priority, a.Tags = "urgent", "rotating_light"
		case is.Severity != "critical":
			continue
		}
		if a.Body == "" {
			a.Body = is.Title
		}
		out = append(out, a)
	}
	if p := st.DeviceMetrics.Storage.UsedPercent; p >= 90 {
		out = append(out, alerts.Alert{Key: "disk-full", Title: "The Pi's disk is almost full", Body: fmt.Sprintf("%.0f%% used. Deploys and databases may fail; clear old files or images.", p), Priority: "high", Tags: "floppy_disk"})
	}
	return out
}

func (s *Server) handleAlerts(w http.ResponseWriter, r *http.Request) {
	if s.Alerts == nil {
		http.Error(w, "alerts are not available", http.StatusNotImplemented)
		return
	}
	switch {
	case r.URL.Path == "/api/alerts" && r.Method == http.MethodGet:
		jsonReply(w, s.Alerts.Status())
	case r.URL.Path == "/api/alerts" && r.Method == http.MethodPost:
		var body alerts.Settings
		if err := decodeJSONBody(r, &body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		if err := s.Alerts.SetSettings(body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, s.Alerts.Status())
	case r.URL.Path == "/api/alerts/test" && r.Method == http.MethodPost:
		var body struct {
			NtfyURL string `json:"ntfy_url"`
		}
		_ = decodeJSONBody(r, &body)
		if err := s.Alerts.Test(r.Context(), body.NtfyURL); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonReply(w, s.Alerts.Status())
	default:
		methodNotAllowed(w)
	}
}
