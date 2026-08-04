package runner

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMullvadEgressFailureClassification(t *testing.T) {
	err := &scriptError{
		script: "update-mullvad-relay",
		cause:  errors.New("exit status 1"),
		output: "WireGuard handshook but Mullvad connection verification failed",
	}
	if !isMullvadEgressFailure(err) {
		t.Fatal("expected egress failure to trigger one relay rotation")
	}
	if isMullvadEgressFailure(errors.New("unrelated")) {
		t.Fatal("unrelated errors must not trigger relay rotation")
	}
}

func TestSummarizeScriptFailureDoesNotExposeShellTrace(t *testing.T) {
	trace := "[#] ip link add mullvad-wg\ncurl: (28) Connection timed out\n[!] WireGuard handshook but Mullvad connection verification failed"
	got := summarizeScriptFailure("update-mullvad-relay", errors.New("exit status 1"), trace)
	if strings.Contains(got, "ip link") || strings.Contains(got, "curl:") || len(got) > 220 {
		t.Fatalf("unsafe or oversized summary: %q", got)
	}
	if !strings.Contains(got, "verified internet") {
		t.Fatalf("summary is not actionable: %q", got)
	}

	timedOut := summarizeScriptFailure("update-mullvad-relay", context.DeadlineExceeded, "")
	if !strings.Contains(timedOut, "timed out") {
		t.Fatalf("timeout summary: %q", timedOut)
	}
}

func TestMullvadPublicKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mullvad-wg.conf")
	if err := os.WriteFile(path, []byte("[Peer]\nPublicKey = relay-key-value\nEndpoint = 192.0.2.1:51820\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := mullvadPublicKey(path); got != "relay-key-value" {
		t.Fatalf("got %q", got)
	}
}

func TestRepairOutputReportsSafeMilestones(t *testing.T) {
	type event struct{ phase, message string }
	var events []event
	out := &repairOutput{report: func(phase, message string) {
		events = append(events, event{phase, message})
	}}
	_, _ = out.Write([]byte("[*] Downloading Mullvad WireGuard relay list\n"))
	_, _ = out.Write([]byte("[+] Updated Mullvad relay: ro-old -> ro-new\n[*] Restart"))
	_, _ = out.Write([]byte("ing mullvad-wg\n[+] You are connected to Mullvad (server ro-new)\n"))
	if len(events) != 4 {
		t.Fatalf("events = %+v", events)
	}
	if events[0].phase != "fetching" || events[1].phase != "selected" ||
		events[2].phase != "restarting" || events[3].phase != "verified" {
		t.Fatalf("unexpected phases: %+v", events)
	}
	for _, ev := range events {
		if strings.Contains(ev.message, "ip link") || strings.Contains(ev.message, "PublicKey") {
			t.Fatalf("unsafe progress message: %+v", ev)
		}
	}
}
