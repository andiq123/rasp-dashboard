package alerts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type sent struct{ Key, Title, Level, Path string }

func barkServer(t *testing.T) (*httptest.Server, *[]sent) {
	var got []sent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m map[string]string
		_ = json.NewDecoder(r.Body).Decode(&m)
		got = append(got, sent{m["device_key"], m["title"], m["level"], r.URL.Path})
		_, _ = w.Write([]byte(`{"code":200,"message":"success"}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

const testKey = "AbCdEf123456"

func TestEvaluateGraceResolveAndLevels(t *testing.T) {
	srv, got := barkServer(t)
	e := New(filepath.Join(t.TempDir(), "alerts.json"))
	if err := e.SetSettings(Settings{Enabled: true, Server: srv.URL, Key: testKey}); err != nil {
		t.Fatal(err)
	}
	ctx, t0 := context.Background(), time.Unix(0, 0)
	vpn := Alert{Key: "vpn", Category: EventInternet, Title: "Wi‑Fi blocked", Body: "x", Urgent: true, Grace: 2 * time.Minute}
	e.Evaluate(ctx, t0, []Alert{vpn})
	e.Evaluate(ctx, t0.Add(time.Minute), []Alert{vpn})
	if len(*got) != 0 {
		t.Fatalf("must wait for the grace period, sent %v", *got)
	}
	e.Evaluate(ctx, t0.Add(2*time.Minute), []Alert{vpn})
	e.Evaluate(ctx, t0.Add(3*time.Minute), []Alert{vpn})
	want := sent{testKey, "Wi‑Fi blocked", "timeSensitive", "/push"}
	if len(*got) != 1 || (*got)[0] != want {
		t.Fatalf("want one time-sensitive push, got %v", *got)
	}
	e.Evaluate(ctx, t0.Add(4*time.Minute), nil)
	if len(*got) != 2 || (*got)[1].Title != "Resolved: Wi‑Fi blocked" || (*got)[1].Level != "passive" {
		t.Fatalf("want a quiet resolved note, got %v", *got)
	}
	e.Evaluate(ctx, t0.Add(5*time.Minute), []Alert{vpn})
	e.Evaluate(ctx, t0.Add(5*time.Minute+30*time.Second), nil)
	if len(*got) != 2 {
		t.Fatalf("a short blip must stay silent, got %v", *got)
	}
}

func TestDisabledThenEnabledAndMuted(t *testing.T) {
	srv, got := barkServer(t)
	e := New(filepath.Join(t.TempDir(), "alerts.json"))
	ctx, t0 := context.Background(), time.Unix(0, 0)
	disk := Alert{Key: "disk", Category: EventPi, Title: "Disk"}
	app := Alert{Key: "app", Category: EventApps, Title: "App"}
	e.Evaluate(ctx, t0, []Alert{disk, app})
	if err := e.SetSettings(Settings{Enabled: true, Server: srv.URL, Key: testKey, Muted: []string{EventApps, "bogus"}}); err != nil {
		t.Fatal(err)
	}
	if st := e.Status(); len(st.Muted) != 1 {
		t.Fatalf("unknown categories are dropped, got %v", st.Muted)
	}
	e.Evaluate(ctx, t0.Add(time.Minute), []Alert{disk, app})
	if len(*got) != 1 || (*got)[0].Title != "Disk" {
		t.Fatalf("an open problem is sent once alerts turn on; muted ones stay quiet, got %v", *got)
	}
}

func TestParseTarget(t *testing.T) {
	server, key, err := ParseTarget("", "https://api.day.app/AbCdEf123456/Title/Body")
	if err != nil || server != DefaultServer || key != testKey {
		t.Fatalf("app URL: %q %q %v", server, key, err)
	}
	if server, key, _ = ParseTarget("", " AbCdEf123456 "); server != DefaultServer || key != testKey {
		t.Fatalf("bare key: %q %q", server, key)
	}
	if server, _, _ = ParseTarget("", "https://bark.example.com/AbCdEf123456"); server != "https://bark.example.com" {
		t.Fatalf("self-hosted server: %q", server)
	}
	for _, bad := range []string{"short", "has spaces in it", "ab$cd%ef!gh"} {
		if _, _, err := ParseTarget("", bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
}

func TestOldChannelSettingsStartOff(t *testing.T) {
	path := filepath.Join(t.TempDir(), "alerts.json")
	_ = os.WriteFile(path, []byte(`{"enabled":true,"muted":["pi"]}`), 0o600)
	_ = os.WriteFile(path, []byte(`{"enabled":true,"ntfy_url":"https://ntfy.sh/x","muted":["pi"]}`), 0o600)
	st := New(path).Status()
	if st.Enabled || st.Key != "" || len(st.Muted) != 1 {
		t.Fatalf("settings without a Bark key must start off but keep muted events, got %+v", st)
	}
	if b, _ := os.ReadFile(path); strings.Contains(string(b), "ntfy") {
		t.Fatalf("old channel settings must be removed from disk, got %s", b)
	}
}
