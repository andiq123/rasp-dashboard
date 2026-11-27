package alerts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestEvaluateGraceResolveAndJSON(t *testing.T) {
	var mu sync.Mutex
	var got []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m map[string]any
		_ = json.NewDecoder(r.Body).Decode(&m)
		m["path"] = r.URL.Path
		mu.Lock()
		got = append(got, m)
		mu.Unlock()
	}))
	defer srv.Close()

	e := New(filepath.Join(t.TempDir(), "alerts.json"))
	if err := e.SetSettings(Settings{Enabled: true, NtfyURL: srv.URL + "/firewifi"}); err != nil {
		t.Fatal(err)
	}
	ctx, t0 := context.Background(), time.Unix(0, 0)
	vpn := Alert{Key: "vpn", Title: "Wi‑Fi blocked", Body: "x", Priority: "urgent", Grace: 2 * time.Minute}
	e.Evaluate(ctx, t0, []Alert{vpn})
	e.Evaluate(ctx, t0.Add(time.Minute), []Alert{vpn})
	if len(got) != 0 {
		t.Fatalf("must wait for the grace period, sent %v", got)
	}
	e.Evaluate(ctx, t0.Add(2*time.Minute), []Alert{vpn})
	e.Evaluate(ctx, t0.Add(3*time.Minute), []Alert{vpn})
	if len(got) != 1 || got[0]["title"] != "Wi‑Fi blocked" || got[0]["topic"] != "firewifi" || got[0]["priority"] != float64(5) || got[0]["path"] != "/" {
		t.Fatalf("want one urgent alert to the topic, got %v", got)
	}
	e.Evaluate(ctx, t0.Add(4*time.Minute), nil)
	if len(got) != 2 || got[1]["title"] != "Resolved: Wi‑Fi blocked" {
		t.Fatalf("want a resolved note, got %v", got)
	}
	// A blip shorter than the grace period never reaches the phone.
	e.Evaluate(ctx, t0.Add(5*time.Minute), []Alert{vpn})
	e.Evaluate(ctx, t0.Add(5*time.Minute+30*time.Second), nil)
	if len(got) != 2 {
		t.Fatalf("short blip must stay silent, got %v", got)
	}
}

func TestValidateURL(t *testing.T) {
	for _, bad := range []string{"ntfy.sh/topic", "https://ntfy.sh", "ftp://x/y"} {
		if _, err := ValidateURL(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
	if _, err := ValidateURL("https://ntfy.sh/my-topic"); err != nil {
		t.Error(err)
	}
}
