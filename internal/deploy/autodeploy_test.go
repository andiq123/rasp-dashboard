package deploy

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestSameCommit(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"abcdef1", "abcdef1234567890", true},
		{"abcdef1234567890", "abcdef1", true},
		{"abc", "abc", true},
		{"aaaaaaa", "bbbbbbb", false},
		{"", "abc", false},
		{"abc", "", false},
	}
	for _, tc := range cases {
		if got := sameCommit(tc.a, tc.b); got != tc.want {
			t.Fatalf("sameCommit(%q,%q)=%v want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestShortSHA(t *testing.T) {
	if got := shortSHA("abcdef123456"); got != "abcdef1" {
		t.Fatalf("got %q", got)
	}
	if got := shortSHA("abc"); got != "abc" {
		t.Fatalf("got %q", got)
	}
}

func TestMergeServicePreserve(t *testing.T) {
	prev := Service{
		AutoDeploy: true, AutoDeploySet: true,
		DeploySHA: "abc1234", PublicURL: "https://x.trycloudflare.com",
		StaticHost: "app.example", TunnelMode: "managed", TunnelHostname: "app.example",
		TunnelVerified: true, TunnelConfigured: true,
	}
	next := Service{Name: "App", Port: 5100}
	got := mergeServicePreserve(prev, next)
	if !got.AutoDeploy || !got.AutoDeploySet {
		t.Fatalf("auto-deploy lost: %+v", got)
	}
	if got.DeploySHA != "abc1234" || got.PublicURL == "" || got.StaticHost != "app.example" ||
		got.TunnelMode != "managed" || got.TunnelHostname != "app.example" {
		t.Fatalf("fields lost: %+v", got)
	}
	if !got.TunnelVerified {
		t.Fatalf("tunnel verification lost: %+v", got)
	}
	if !got.TunnelConfigured {
		t.Fatalf("saved tunnel configuration lost: %+v", got)
	}
	if got.Name != "App" || got.Port != 5100 {
		t.Fatalf("next fields overwritten: %+v", got)
	}
}

func TestOriginsMatch(t *testing.T) {
	if !originsMatch("", "http://127.0.0.1:5100") {
		t.Fatal("empty unit should match")
	}
	if !originsMatch("http://127.0.0.1:5100", "http://127.0.0.1:5100") {
		t.Fatal("equal should match")
	}
	if originsMatch("http://127.0.0.1:5100", "http://127.0.0.1:5101") {
		t.Fatal("different ports must not match")
	}
}

func TestLocalOriginURL(t *testing.T) {
	if got := localOriginURL(5100); got != "http://127.0.0.1:5100" {
		t.Fatalf("got %q", got)
	}
	if got := localOriginURL(0); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestValidGitHubSignature(t *testing.T) {
	body := []byte(`{"ref":"refs/heads/main"}`)
	secret := "test-secret"
	// precomputed: echo -n '{"ref":"refs/heads/main"}' | openssl dgst -sha256 -hmac test-secret
	// compute in test via valid path roundtrip using our own mac
	macOK := validGitHubSignature(body, "sha256=deadbeef", secret)
	if macOK {
		t.Fatal("bad digest should fail")
	}
	if validGitHubSignature(body, "", secret) {
		t.Fatal("empty sig should fail")
	}
}

func TestPublicGitHubHookURL(t *testing.T) {
	t.Setenv("FIREWIFI_PUBLIC_URL", "")
	if got := publicGitHubHookURL(); got != "" {
		t.Fatalf("empty env: got %q", got)
	}
	t.Setenv("FIREWIFI_PUBLIC_URL", "https://pi.example.com/")
	if got := publicGitHubHookURL(); got != "https://pi.example.com/api/hooks/github" {
		t.Fatalf("got %q", got)
	}
}

func TestGitHubPushSchedulesAndRecordsAcceptedCommit(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir, Activity: newActivityHub()}
	if err := m.saveRegistry(registry{
		Groups: []Group{{Slug: "g", Name: "G"}},
		Services: []Service{{
			Group: "g", Slug: "api", Name: "API", Type: TypeGo,
			Repo: "owner/api", Branch: "main", AutoDeploy: true, AutoDeploySet: true,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	secret := "deploy-secret"
	if err := os.MkdirAll(filepath.Dir(m.deployTokenPath()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(m.deployTokenPath(), []byte(secret), 0o600); err != nil {
		t.Fatal(err)
	}
	m.jobBusy = true
	m.jobScope = "g/other"
	body := []byte(`{"ref":"refs/heads/main","after":"abcdef1234567890","repository":{"full_name":"owner/api"}}`)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	services, err := m.HandleGitHubPush(context.Background(), body, signature)
	if err != nil {
		t.Fatal(err)
	}
	if len(services) != 1 || services[0].Status != "queued" {
		t.Fatalf("services=%+v", services)
	}
	if len(m.deployQueue) != 1 || m.deployQueue[0].reason != "webhook" {
		t.Fatalf("queue=%+v", m.deployQueue)
	}
	reg, err := m.loadRegistry()
	if err != nil {
		t.Fatal(err)
	}
	got, idx := findService(reg, "g", "api")
	if idx < 0 || got.DeploySHA != "abcdef1234567890" {
		t.Fatalf("service=%+v", got)
	}
}

func TestFriendlyGitFailure(t *testing.T) {
	for _, message := range []string{
		"fatal: unable to access repo: Failed to connect to github.com port 443",
		"fatal: unable to access repo: Could not resolve host: github.com",
		"fatal: Network is unreachable",
	} {
		got := friendlyGitFailure(message, nil).Error()
		if got != "GitHub is unreachable from this Pi — check its internet, DNS, or VPN route, then Redeploy" {
			t.Fatalf("message=%q got=%q", message, got)
		}
	}
	if got := friendlyGitFailure("fatal: repository not found", nil).Error(); got != "git: fatal: repository not found" {
		t.Fatalf("specific git failure lost: %q", got)
	}
}
