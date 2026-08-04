package deploy

import (
	"context"
	"os"
	"testing"
)

func TestDashboardAuthEnabled(t *testing.T) {
	original := os.Getenv("FIREWIFI_AUTH")
	t.Cleanup(func() { _ = os.Setenv("FIREWIFI_AUTH", original) })
	for _, tc := range []struct {
		value string
		want  bool
	}{{"", false}, {"broken", false}, {"user:", false}, {"user:secret", true}} {
		_ = os.Setenv("FIREWIFI_AUTH", tc.value)
		if got := dashboardAuthEnabled(); got != tc.want {
			t.Fatalf("dashboardAuthEnabled(%q)=%v want %v", tc.value, got, tc.want)
		}
	}
}

func TestDashboardTunnelRequiresPublicAccessProtection(t *testing.T) {
	t.Setenv("FIREWIFI_AUTH", "")
	m := &Manager{DeployDir: t.TempDir()}
	if _, err := m.StartDashboardTunnel(context.Background(), "quick", "", "", false); err == nil {
		t.Fatal("quick tunnel without auth should be rejected")
	}
	if _, err := m.StartDashboardTunnel(context.Background(), "managed", "", "dashboard.example.com", false); err == nil {
		t.Fatal("managed tunnel without Access confirmation should be rejected")
	}
}
