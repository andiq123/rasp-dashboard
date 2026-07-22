package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"firewifi/dashboard/internal/deploy"
)

func testDeployManager(t *testing.T) *deploy.Manager {
	t.Helper()
	return &deploy.Manager{DeployDir: t.TempDir()}
}

func TestHandleEngineActionValidation(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "unknown action",
			body:       `{"action":"restart"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "unknown action\n",
		},
		{
			name:       "empty action updates",
			body:       `{"postgres_version":"16","go_toolchain":"auto"}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "update action",
			body:       `{"action":"update","go_toolchain":"auto"}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "start reaches deploy",
			body:       `{"action":"start"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "postgres engine not configured\n",
		},
		{
			name:       "stop reaches deploy",
			body:       `{"action":"stop"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "postgres engine not configured\n",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &Server{Deploy: testDeployManager(t)}
			req := httptest.NewRequest(http.MethodPut, "/api/engine", bytes.NewBufferString(tc.body))
			rec := httptest.NewRecorder()
			s.handleEngine(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d body=%q", rec.Code, rec.Body.String())
			}
			if tc.wantBody != "" && rec.Body.String() != tc.wantBody {
				t.Fatalf("body = %q want %q", rec.Body.String(), tc.wantBody)
			}
		})
	}
}

func TestManageOverviewDockerErrorJSON(t *testing.T) {
	b, err := json.Marshal(deploy.ManageOverview{DockerError: "docker unavailable"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(b, []byte(`"docker_error":"docker unavailable"`)) {
		t.Fatalf("payload = %s", b)
	}
}
