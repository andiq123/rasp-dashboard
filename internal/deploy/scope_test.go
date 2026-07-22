package deploy

import "testing"

func TestContainerScopeNames(t *testing.T) {
	if got := containerName("findvibe", "api"); got != "fw-findvibe-api" {
		t.Fatalf("runtime name: %s", got)
	}
	if got := buildContainerName("findvibe", "api"); got != "fw-build-findvibe-api" {
		t.Fatalf("build name: %s", got)
	}
	labels := dockerScopeLabels("findvibe", "api", "runtime")
	joined := ""
	for _, a := range labels {
		joined += a + " "
	}
	for _, want := range []string{
		"firewifi.managed=1",
		"firewifi.group=findvibe",
		"firewifi.service=api",
		"firewifi.role=runtime",
	} {
		if !contains(joined, want) {
			t.Fatalf("missing label %s in %s", want, joined)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
