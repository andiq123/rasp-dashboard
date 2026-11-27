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
	alertInterval = 15 * time.Second
	reminderEvery = 2 * time.Minute
	// Below this the paid proxy is about to run dry (decimal bytes, as IPRoyal bills).
	lowBalanceBytes = 200e6
)

// gb formats decimal gigabytes, matching the IPRoyal dashboard.
func gb(b uint64) string { return fmt.Sprintf("%.2f GB", float64(b)/1e9) }

func residentialReminder(u state.ResidentialUsage) string {
	msg := fmt.Sprintf("On for %s, about %s this session.", humanDuration(time.Since(u.SessionStart)), gb(u.SessionBytes))
	if u.RemainingBytes != nil {
		msg += fmt.Sprintf(" About %s left.", gb(*u.RemainingBytes))
	} else {
		msg += fmt.Sprintf(" %s this month.", gb(u.MonthBytes))
	}
	return msg + " Switch back to Mullvad when you are done."
}

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
			if started, ok := sw.observe(st); ok {
				go s.verifySwitch(ctx, started)
			}
			sendCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			s.Alerts.Evaluate(sendCtx, now, append(alertsFromState(st), s.uptimeAlerts()...))
			cancel()
		}
	}
}

// routeSwitch notices a Mullvad ⇄ residential change between health ticks.
type routeSwitch struct {
	mode string // last seen mode
}

type switchStarted struct {
	to    string
	usage state.ResidentialUsage // residential session at the moment of the switch
}

func (w *routeSwitch) observe(st state.State) (switchStarted, bool) {
	changed := w.mode != "" && st.Mode != w.mode
	w.mode = st.Mode
	if !changed {
		return switchStarted{}, false
	}
	return switchStarted{to: st.Mode, usage: st.Residential}, true
}

// verifyEvery and switchDeadline bound how long a switch may take to prove itself.
var (
	verifyEvery    = 5 * time.Second
	switchDeadline = 3 * time.Minute
)

// verifySwitch reports a switch only once traffic really leaves through the new
// route: the exit address is fetched through it (Romania required for Mullvad).
func (s *Server) verifySwitch(ctx context.Context, sw switchStarted) {
	lookup, ok := s.State.(ExitLookup)
	deadline := time.Now().Add(switchDeadline)
	var exit state.Exit
	var lastErr error
	for ok && time.Now().Before(deadline) {
		lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		e, err := lookup.LookupExit(lctx, sw.to)
		cancel()
		switch {
		case err != nil:
			lastErr = err
		case sw.to == state.ModeMullvad && e.Country != "RO":
			lastErr = fmt.Errorf("exit is in %s, not Romania", e.Country)
		default:
			exit, lastErr = e, nil
		}
		if lastErr == nil {
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(verifyEvery):
		}
	}
	name := modeName[sw.to]
	if exit.IP == "" {
		reason := "Traffic could not get out through the new route."
		if lastErr != nil {
			reason = "Traffic could not get out through the new route (" + lastErr.Error() + ")."
		}
		s.Alerts.Notify(ctx, alerts.Alert{Category: alerts.EventRoute, Urgent: true, Title: "Switch to " + name + " failed", Body: reason + " Wi‑Fi is held until it works; open the dashboard to repair it."})
		return
	}
	a := alerts.Alert{Category: alerts.EventRoute}
	if sw.to == state.ModeResidential {
		a.Title = "Residential is working"
		a.Body = fmt.Sprintf("Verified: Wi‑Fi exits from %s (%s). Data is billed per GB.", exit.IP, exit.Country)
	} else {
		a.Title = "Mullvad is working"
		a.Body = fmt.Sprintf("Verified: Wi‑Fi exits from %s (%s), encrypted.", exit.IP, exit.Country)
		if u := sw.usage; u.SessionBytes > 0 && !u.SessionStart.IsZero() {
			a.Body += fmt.Sprintf(" Residential used %s in %s.", gb(u.SessionBytes), humanDuration(time.Since(u.SessionStart)))
		}
	}
	s.Alerts.Notify(ctx, a)
}

var modeName = map[string]string{state.ModeMullvad: "Mullvad", state.ModeResidential: "Residential"}

// notifySwitchStart opens the switch story quietly; the watcher closes it with
// the result and the new exit address once the route carries traffic.
func (s *Server) notifySwitchStart(mode string) {
	if s.Alerts == nil {
		return
	}
	s.Alerts.Notify(context.Background(), alerts.Alert{Category: alerts.EventRoute, Quiet: true, Title: "Switching to " + modeName[mode] + "…", Body: "Wi‑Fi may drop for a moment. You will get a note once the new route is verified."})
}

func (s *Server) notifySwitchFailed(mode string, err error) {
	if s.Alerts == nil {
		return
	}
	s.Alerts.Notify(context.Background(), alerts.Alert{Category: alerts.EventRoute, Urgent: true, Title: "Switch to " + modeName[mode] + " failed", Body: err.Error()})
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
			Body:  residentialReminder(u),
			Grace: reminderEvery, Repeat: reminderEvery, NoResolve: true,
		})
		// Running out on residential means no internet: warn while there is time.
		if left := u.RemainingBytes; left != nil && *left < lowBalanceBytes {
			out = append(out, alerts.Alert{
				Key: "residential-low", Category: alerts.EventCost, Urgent: true, NoResolve: true,
				Title: "Residential data almost used up",
				Body:  fmt.Sprintf("About %s left. Add data on IPRoyal or switch back to Mullvad.", gb(*left)),
			})
		}
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
	case r.URL.Path == "/api/alerts/error" && r.Method == http.MethodDelete:
		s.Alerts.ClearError()
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
