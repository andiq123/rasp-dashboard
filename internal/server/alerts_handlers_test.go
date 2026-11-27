package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"firewifi/dashboard/internal/alerts"

	"firewifi/dashboard/internal/state"
)

func TestRouteSwitchNoticesModeChanges(t *testing.T) {
	var w routeSwitch
	if _, ok := w.observe(state.State{Mode: state.ModeMullvad}); ok {
		t.Fatal("the first state is not a switch")
	}
	if _, ok := w.observe(state.State{Mode: state.ModeMullvad}); ok {
		t.Fatal("same mode is not a switch")
	}
	res := state.State{Mode: state.ModeResidential}
	res.Residential.SessionBytes = 42
	sw, ok := w.observe(res)
	if !ok || sw.to != state.ModeResidential || sw.usage.SessionBytes != 42 {
		t.Fatalf("a mode change starts verification: %+v %v", sw, ok)
	}
}

func TestResidentialReminder(t *testing.T) {
	st := state.State{Mode: state.ModeResidential, ProxyRunning: true}
	st.Residential = state.ResidentialUsage{Active: true, SessionStart: time.Now().Add(-75 * time.Minute), SessionBytes: 350 << 20, MonthBytes: 2 << 30}
	var found bool
	for _, a := range alertsFromState(st) {
		if a.Key == "residential-on" {
			found = a.Repeat == reminderEvery && a.Body == "On for 1 h 15 min, about 0.37 GB this session. 2.15 GB this month. Switch back to Mullvad when you are done."
		}
	}
	if !found {
		t.Fatalf("residential reminder missing or wrong: %+v", alertsFromState(st))
	}
}

func TestResidentialLowBalance(t *testing.T) {
	left := uint64(150e6)
	st := state.State{Mode: state.ModeResidential, ProxyRunning: true}
	st.Residential = state.ResidentialUsage{Active: true, SessionStart: time.Now(), RemainingBytes: &left}
	var low, reminder string
	for _, a := range alertsFromState(st) {
		switch a.Key {
		case "residential-low":
			low = a.Body
		case "residential-on":
			reminder = a.Body
		}
	}
	if low != "About 0.15 GB left. Add data on IPRoyal or switch back to Mullvad." {
		t.Fatalf("low balance alert: %q", low)
	}
	if reminder != "On for under a minute, about 0.00 GB this session. About 0.15 GB left. Switch back to Mullvad when you are done." {
		t.Fatalf("reminder includes what is left: %q", reminder)
	}
}

type fakeRoute struct {
	failures int
	exit     state.Exit
}

func (f *fakeRoute) Read() (state.State, error) { return state.State{}, nil }
func (f *fakeRoute) LookupExit(context.Context, string) (state.Exit, error) {
	if f.failures > 0 {
		f.failures--
		return state.Exit{}, errors.New("no route yet")
	}
	return f.exit, nil
}

func verifyWith(t *testing.T, route *fakeRoute, to string) []string {
	t.Helper()
	oldEvery, oldDeadline := verifyEvery, switchDeadline
	verifyEvery, switchDeadline = time.Millisecond, 200*time.Millisecond
	defer func() { verifyEvery, switchDeadline = oldEvery, oldDeadline }()
	var titles []string
	bark := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m map[string]string
		_ = json.NewDecoder(r.Body).Decode(&m)
		titles = append(titles, m["title"]+": "+m["body"])
		_, _ = w.Write([]byte(`{"code":200}`))
	}))
	defer bark.Close()
	e := alerts.New(filepath.Join(t.TempDir(), "alerts.json"), nil)
	if err := e.SetSettings(alerts.Settings{Enabled: true, Server: bark.URL, Key: "AbCdEf123456"}); err != nil {
		t.Fatal(err)
	}
	s := &Server{State: route, Alerts: e}
	s.verifySwitch(context.Background(), switchStarted{to: to})
	e.Wait()
	return titles
}

func TestVerifySwitch(t *testing.T) {
	ok := verifyWith(t, &fakeRoute{failures: 2, exit: state.Exit{IP: "135.136.63.41", Country: "RO"}}, state.ModeMullvad)
	if len(ok) != 1 || ok[0] != "Mullvad is working: Verified: Wi‑Fi exits from 135.136.63.41 (RO), encrypted." {
		t.Fatalf("success is announced only after the route answers: %v", ok)
	}
	wrong := verifyWith(t, &fakeRoute{exit: state.Exit{IP: "1.2.3.4", Country: "DE"}}, state.ModeMullvad)
	if len(wrong) != 1 || wrong[0][:len("Switch to Mullvad failed")] != "Switch to Mullvad failed" {
		t.Fatalf("a non-Romanian Mullvad exit is a failure: %v", wrong)
	}
	never := verifyWith(t, &fakeRoute{failures: 1 << 30}, state.ModeResidential)
	if len(never) != 1 || never[0][:len("Switch to Residential failed")] != "Switch to Residential failed" {
		t.Fatalf("a route that never works is reported as failed: %v", never)
	}
}
