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

const (
	alertInterval  = 15 * time.Second
	switchDeadline = 3 * time.Minute
	reminderEvery  = 2 * time.Minute
)

// ExitLookup reports the public address Wi-Fi leaves from (the state reader).
type ExitLookup interface {
	LookupExit(ctx context.Context, mode string) (state.Exit, error)
}

// watchAlerts turns the dashboard's own health checks into phone notifications,
// and announces a finished route switch with the new exit address.
func (s *Server) watchAlerts(ctx context.Context) {
	tick := time.NewTicker(alertInterval)
	defer tick.Stop()
	var sw routeSwitch
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			st, err := s.State.Read()
			if err != nil {
				continue
			}
			now := time.Now()
			if done, ok := sw.observe(st, now); ok {
				go s.announceSwitch(ctx, done, st)
			}
			sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			s.Alerts.Evaluate(sendCtx, now, append(alertsFromState(st), s.uptimeAlerts()...))
			cancel()
		}
	}
}

// routeSwitch follows one Mullvad ⇄ residential change until the new route
// actually carries traffic (or gives up after a deadline).
type routeSwitch struct {
	mode    string // last seen mode
	to      string // switch in progress, "" when none
	since   time.Time
	usage   state.ResidentialUsage // residential session at the moment of the switch
	expired bool
}

type switchDone struct {
	to      string
	took    time.Duration
	usage   state.ResidentialUsage
	expired bool
}

func (w *routeSwitch) observe(st state.State, now time.Time) (switchDone, bool) {
	if w.mode != "" && st.Mode != w.mode {
		w.to, w.since, w.usage = st.Mode, now, st.Residential
	}
	w.mode = st.Mode
	if w.to == "" {
		return switchDone{}, false
	}
	ready := (w.to == state.ModeMullvad && st.VPNHealth.EgressOK) ||
		(w.to == state.ModeResidential && st.ProxyRunning && st.HotspotRunning)
	timedOut := now.Sub(w.since) > switchDeadline
	if !ready && !timedOut {
		return switchDone{}, false
	}
	done := switchDone{to: w.to, took: now.Sub(w.since), usage: w.usage, expired: !ready}
	w.to = ""
	return done, true
}

func (s *Server) announceSwitch(ctx context.Context, d switchDone, st state.State) {
	name := map[string]string{state.ModeMullvad: "Mullvad", state.ModeResidential: "Residential"}[d.to]
	if d.expired {
		s.Alerts.Notify(ctx, alerts.Alert{Category: alerts.EventRoute, Urgent: true, Title: "Switch to " + name + " has not finished", Body: "Wi‑Fi traffic is held until the new route works. Open the dashboard to repair it."})
		return
	}
	exit := "The exit address could not be checked."
	if lookup, ok := s.State.(ExitLookup); ok {
		lctx, cancel := context.WithTimeout(ctx, 12*time.Second)
		if e, err := lookup.LookupExit(lctx, d.to); err == nil {
			exit = fmt.Sprintf("Wi‑Fi now exits from %s (%s).", e.IP, e.Country)
		}
		cancel()
	}
	a := alerts.Alert{Category: alerts.EventRoute}
	if d.to == state.ModeResidential {
		a.Title, a.Body = "Now on Residential", exit+" Residential data is billed per GB."
	} else {
		a.Title, a.Body = "Back on Mullvad", exit
		if st.VPNHealth.Relay != "" {
			a.Body = strings.TrimSuffix(exit, ".") + " through " + st.VPNHealth.Relay + "."
		}
		if u := d.usage; u.SessionBytes > 0 {
			a.Body += fmt.Sprintf(" Residential used %s in %s.", humanBytes(int64(u.SessionBytes)), humanDuration(time.Since(u.SessionStart)-d.took))
		}
	}
	s.Alerts.Notify(ctx, a)
}

func humanDuration(d time.Duration) string {
	d = d.Round(time.Minute)
	if d < time.Minute {
		return "under a minute"
	}
	if h := int(d.Hours()); h > 0 {
		return fmt.Sprintf("%d h %d min", h, int(d.Minutes())%60)
	}
	return fmt.Sprintf("%d min", int(d.Minutes()))
}

// alertsFromState maps current health to alerts. Outages wait two minutes so a
// self-healing blip (the VPN repair usually fixes itself) never pings the phone.
func alertsFromState(st state.State) []alerts.Alert {
	var out []alerts.Alert
	for _, is := range st.Issues {
		a := alerts.Alert{Key: is.Code, Title: is.Title, Body: is.Detail, Grace: 2 * time.Minute}
		switch {
		case is.Code == "mullvad-expiring":
			a.Category, a.Grace, a.NoResolve = alerts.EventMullvad, 0, true
		case strings.HasPrefix(is.Code, "app-crash:"):
			a.Category, a.Grace = alerts.EventApps, 0
		case is.Code == "temperature-high" || is.Code == "thermal-throttling":
			a.Category, a.Grace = alerts.EventPi, 5*time.Minute
		case is.Code == "uplink-offline" || strings.HasPrefix(is.Code, "vpn-") || is.Code == "hotspot-down" || is.Code == "proxy-down":
			// Outages break through Focus: the Wi-Fi is unusable until fixed.
			a.Category, a.Urgent = alerts.EventInternet, true
		case is.Severity == "critical":
			a.Category = alerts.EventInternet
		default:
			continue
		}
		if a.Body == "" {
			a.Body = is.Title
		}
		out = append(out, a)
	}
	// The paid proxy is on: remind every few minutes with what it has used.
	if u := st.Residential; st.Mode == state.ModeResidential && st.ProxyRunning && u.Active {
		out = append(out, alerts.Alert{
			Key: "residential-on", Category: alerts.EventCost, Title: "Still on Residential",
			Body:  fmt.Sprintf("On for %s, about %s this session and %s this month. Switch back to Mullvad when you are done.", humanDuration(time.Since(u.SessionStart)), humanBytes(int64(u.SessionBytes)), humanBytes(int64(u.MonthBytes))),
			Grace: reminderEvery, Repeat: reminderEvery, NoResolve: true,
		})
	}
	if p := st.DeviceMetrics.Storage.UsedPercent; p >= 90 {
		out = append(out, alerts.Alert{Key: "disk-full", Category: alerts.EventPi, Title: "The Pi's disk is almost full", Body: fmt.Sprintf("%.0f%% used. Deploys and databases may fail; clear old files or images.", p)})
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
			Server string `json:"server"`
			Key    string `json:"key"`
		}
		_ = decodeJSONBody(r, &body)
		if err := s.Alerts.Test(r.Context(), body.Server, body.Key); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonReply(w, s.Alerts.Status())
	default:
		methodNotAllowed(w)
	}
}
