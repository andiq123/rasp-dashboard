package state

import (
	"testing"
	"time"
)

func TestNormalizeAndMaskAccount(t *testing.T) {
	n, err := normalizeAccount("1234 5678 9012 3456")
	if err != nil || n != "1234567890123456" {
		t.Fatalf("normalizeAccount = %q, %v", n, err)
	}
	if _, err := normalizeAccount("1234"); err == nil {
		t.Fatal("short account number must be rejected")
	}
	if got := maskAccount(n); got != "•••• •••• •••• 3456" {
		t.Fatalf("maskAccount = %q", got)
	}
}

func TestAccountViewDaysLeft(t *testing.T) {
	c := &accountCache{number: "1234567890123456", expiry: time.Now().Add(72*time.Hour + time.Minute), at: time.Now()}
	v := c.view()
	if !v.Configured || v.DaysLeft == nil || *v.DaysLeft != 3 || v.Masked == "" {
		t.Fatalf("view = %+v", v)
	}
	if (&accountCache{}).view().Configured {
		t.Fatal("empty cache must not be configured")
	}
}
