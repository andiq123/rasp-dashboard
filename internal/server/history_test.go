package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"firewifi/dashboard/internal/deploy"
	"firewifi/dashboard/internal/monitor"
)

func TestHistoryEndpointsKeepSubjectsSeparate(t *testing.T) {
	t.Setenv("FIREWIFI_AUTH", "")
	store, err := monitor.Open(filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Now().Unix()
	if err := store.Put([]monitor.Sample{
		{Subject: monitor.SystemSubject(), Point: monitor.Point{At: now, CPUPercent: 12}},
		{Subject: monitor.ServiceSubject("apps", "api"), Point: monitor.Point{At: now, CPUPercent: 42, Running: true}},
	}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{History: store, Deploy: &deploy.Manager{}}

	for _, tc := range []struct {
		path string
		want float64
	}{
		{"/api/history/system?range=1h", 12},
		{"/api/groups/apps/services/api/history?range=1h", 42},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		res := httptest.NewRecorder()
		srv.Handler().ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", tc.path, res.Code, res.Body.String())
		}
		var series monitor.Series
		if err := json.Unmarshal(res.Body.Bytes(), &series); err != nil {
			t.Fatal(err)
		}
		if len(series.Points) != 1 || series.Points[0].CPUPercent != tc.want {
			t.Fatalf("%s series=%+v", tc.path, series)
		}
	}
}
