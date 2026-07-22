package deploy

import "testing"

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
		StaticHost: "app.example",
	}
	next := Service{Name: "App", Port: 5100}
	got := mergeServicePreserve(prev, next)
	if !got.AutoDeploy || !got.AutoDeploySet {
		t.Fatalf("auto-deploy lost: %+v", got)
	}
	if got.DeploySHA != "abc1234" || got.PublicURL == "" || got.StaticHost != "app.example" {
		t.Fatalf("fields lost: %+v", got)
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
