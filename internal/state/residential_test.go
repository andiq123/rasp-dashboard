package state

import (
	"testing"
	"time"
)

func TestAdvanceUsage(t *testing.T) {
	t0 := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	u := advanceUsage(ResidentialUsage{}, true, 1000, true, 0, false, t0)
	if !u.Active || u.SessionBytes != 0 || !u.SessionStart.Equal(t0) {
		t.Fatalf("switching on starts an empty session: %+v", u)
	}
	u = advanceUsage(u, true, 6000, true, 1000, true, t0.Add(time.Minute))
	if u.SessionBytes != 5000 || u.MonthBytes != 5000 {
		t.Fatalf("hotspot bytes count while residential: %+v", u)
	}
	u = advanceUsage(u, true, 200, true, 6000, true, t0.Add(2*time.Minute))
	if u.SessionBytes != 5200 {
		t.Fatalf("a restarted interface counts from zero, not negative: %+v", u)
	}
	u = advanceUsage(u, false, 9000, true, 200, true, t0.Add(3*time.Minute))
	if u.Active || u.SessionBytes != 5200 {
		t.Fatalf("Mullvad stops counting and keeps the finished session: %+v", u)
	}
	u = advanceUsage(u, false, 9000, true, 9000, true, time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC))
	if u.MonthBytes != 0 || u.Month != "2026-12" {
		t.Fatalf("a new month starts at zero: %+v", u)
	}
}

func TestBalanceCountsDown(t *testing.T) {
	now := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	u := ResidentialUsage{TotalBytes: 5e9, BalanceBytes: 790e6, BalanceSetAt: now, BalanceTotalAt: 5e9}
	if got := u.withBalance(now); got.RemainingBytes == nil || *got.RemainingBytes != 790e6 || got.BalanceStale {
		t.Fatalf("fresh balance: %+v", got)
	}
	u.TotalBytes += 300e6
	if got := u.withBalance(now.Add(time.Hour)); *got.RemainingBytes != 490e6 {
		t.Fatalf("usage since the entry counts down: %+v", *got.RemainingBytes)
	}
	u.TotalBytes += 2e9
	if got := u.withBalance(now.Add(8 * 24 * time.Hour)); *got.RemainingBytes != 0 || !got.BalanceStale {
		t.Fatalf("never below zero, and stale after a week: %+v", got)
	}
	if got := (ResidentialUsage{}).withBalance(now); got.RemainingBytes != nil {
		t.Fatal("no balance entered means no remaining figure")
	}
}
