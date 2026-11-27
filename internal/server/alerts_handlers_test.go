package server

import (
	"testing"
	"time"

	"firewifi/dashboard/internal/state"
)

func TestRouteSwitchWaitsForTheNewRoute(t *testing.T) {
	var w routeSwitch
	t0 := time.Unix(0, 0)
	mullvad := state.State{Mode: state.ModeMullvad}
	mullvad.VPNHealth.EgressOK = true
	if _, ok := w.observe(mullvad, t0); ok {
		t.Fatal("the first state is not a switch")
	}
	res := state.State{Mode: state.ModeResidential, HotspotRunning: true}
	if _, ok := w.observe(res, t0.Add(15*time.Second)); ok {
		t.Fatal("not done until the proxy runs")
	}
	res.ProxyRunning = true
	d, ok := w.observe(res, t0.Add(30*time.Second))
	if !ok || d.to != state.ModeResidential || d.expired || d.took != 15*time.Second {
		t.Fatalf("switch finishes once the proxy carries traffic: %+v %v", d, ok)
	}
	if _, ok := w.observe(res, t0.Add(45*time.Second)); ok {
		t.Fatal("announced once")
	}
	back := state.State{Mode: state.ModeMullvad}
	w.observe(back, t0.Add(time.Minute))
	d, ok = w.observe(back, t0.Add(5*time.Minute))
	if !ok || !d.expired {
		t.Fatalf("a switch that never works is reported after the deadline: %+v %v", d, ok)
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
