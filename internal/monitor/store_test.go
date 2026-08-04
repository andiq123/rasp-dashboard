package monitor

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func TestStoreQueryDownsamplesAndSeparatesSubjects(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	now := time.Now().Add(-time.Minute).Unix()
	for i := 0; i < 20; i++ {
		err = s.Put([]Sample{
			{Subject: SystemSubject(), Point: Point{At: now + int64(i), CPUPercent: float64(i)}},
			{Subject: ServiceSubject("apps", "api"), Point: Point{At: now + int64(i), MemoryMB: float64(i)}},
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Query(SystemSubject(), time.Unix(now-1, 0), 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Points) != 5 {
		t.Fatalf("points=%d want 5", len(got.Points))
	}
	if got.Points[0].CPUPercent != 0 || got.Points[4].CPUPercent != 19 {
		t.Fatalf("endpoints not retained: %+v", got.Points)
	}
	if got.Points[0].MemoryMB != 0 {
		t.Fatalf("service data leaked into system series: %+v", got.Points[0])
	}
}

func TestStorePrunesExpiredSamplesOnEveryWrite(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.retention = time.Hour
	now := time.Now()
	if err := s.Put([]Sample{{Subject: SystemSubject(), Point: Point{At: now.Unix(), CPUPercent: 20}}}); err != nil {
		t.Fatal(err)
	}
	// Seed an expired key directly so the next normal write proves that cleanup
	// happens in the same transaction without a scheduled sweep.
	if err := s.db.Update(func(tx *bolt.Tx) error {
		series := tx.Bucket(seriesBucket).Bucket([]byte(SystemSubject()))
		value, _ := json.Marshal(Point{At: now.Add(-2 * time.Hour).Unix(), CPUPercent: 10})
		return series.Put(timeKey(now.Add(-2*time.Hour).Unix()), value)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.Put([]Sample{{Subject: ServiceSubject("apps", "api"), Point: Point{At: now.Unix(), CPUPercent: 5}}}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Query(SystemSubject(), now.Add(-3*time.Hour), 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Points) != 1 || got.Points[0].CPUPercent != 20 {
		t.Fatalf("unexpected points: %+v", got.Points)
	}
}
