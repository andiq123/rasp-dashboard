package monitor

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	defaultRetention = 7 * 24 * time.Hour
	maxQueryPoints   = 360
)

var seriesBucket = []byte("series-v2")

// Point is a compact common sample used for both host and service history.
// Fields that do not apply to a subject remain zero and are omitted from JSON.
type Point struct {
	At            int64   `json:"at"`
	CPUPercent    float64 `json:"cpu_percent,omitempty"`
	MemoryMB      float64 `json:"memory_mb,omitempty"`
	MemoryPercent float64 `json:"memory_percent,omitempty"`
	TemperatureC  float64 `json:"temperature_c,omitempty"`
	DiskPercent   float64 `json:"disk_percent,omitempty"`
	DownBPS       float64 `json:"down_bps,omitempty"`
	UpBPS         float64 `json:"up_bps,omitempty"`
	PIDs          int     `json:"pids,omitempty"`
	Running       bool    `json:"running,omitempty"`
}

type Sample struct {
	Subject string
	Point   Point
}

type Series struct {
	Subject   string  `json:"subject"`
	From      int64   `json:"from"`
	To        int64   `json:"to"`
	Retention int64   `json:"retention_seconds"`
	Points    []Point `json:"points"`
}

// Store is an embedded, single-file time-series store. Bolt is pure Go, so the
// production build remains CGO-free on Raspberry Pi.
type Store struct {
	db        *bolt.DB
	retention time.Duration
}

func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("history path required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: time.Second, NoFreelistSync: true})
	if err != nil {
		return nil, err
	}
	s := &Store{db: db, retention: defaultRetention}
	if err := db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists(seriesBucket)
		return err
	}); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// Put prunes and writes one monitor tick in a single transaction. Each subject
// is time-ordered, so cleanup only visits expired entries at the bucket head.
func (s *Store) Put(samples []Sample) error {
	if s == nil || s.db == nil || len(samples) == 0 {
		return nil
	}
	now := time.Now()
	cutoff := now.Add(-s.retention).Unix()
	return s.db.Update(func(tx *bolt.Tx) error {
		root := tx.Bucket(seriesBucket)
		if err := pruneSeries(root, cutoff); err != nil {
			return err
		}
		for _, sample := range samples {
			subject := cleanSubject(sample.Subject)
			if subject == "" {
				continue
			}
			if sample.Point.At <= 0 {
				sample.Point.At = now.Unix()
			}
			if sample.Point.At < cutoff {
				continue
			}
			series, err := root.CreateBucketIfNotExists([]byte(subject))
			if err != nil {
				return err
			}
			value, err := json.Marshal(sample.Point)
			if err != nil {
				return err
			}
			if err := series.Put(timeKey(sample.Point.At), value); err != nil {
				return err
			}
		}
		return nil
	})
}

// Query returns evenly downsampled points, keeping responses and chart work bounded.
func (s *Store) Query(subject string, since time.Time, limit int) (Series, error) {
	subject = cleanSubject(subject)
	if subject == "" {
		return Series{}, errors.New("history subject required")
	}
	if limit <= 0 || limit > maxQueryPoints {
		limit = 240
	}
	now := time.Now()
	oldest := now.Add(-s.retention)
	if since.IsZero() || since.Before(oldest) {
		since = oldest
	}
	series := Series{
		Subject: subject, From: since.Unix(), To: now.Unix(),
		Retention: int64(s.retention.Seconds()), Points: []Point{},
	}
	if s == nil || s.db == nil {
		return series, nil
	}
	err := s.db.View(func(tx *bolt.Tx) error {
		dataBucket := tx.Bucket(seriesBucket).Bucket([]byte(subject))
		if dataBucket == nil {
			return nil
		}
		c := dataBucket.Cursor()
		for k, v := c.Seek(timeKey(since.Unix())); k != nil; k, v = c.Next() {
			var point Point
			if json.Unmarshal(v, &point) == nil {
				series.Points = append(series.Points, point)
			}
		}
		return nil
	})
	if err != nil {
		return Series{}, err
	}
	series.Points = downsample(series.Points, limit)
	return series, nil
}

func pruneSeries(root *bolt.Bucket, cutoff int64) error {
	if root == nil {
		return nil
	}
	empty := make([][]byte, 0)
	if err := root.ForEach(func(name, value []byte) error {
		if value != nil {
			return nil
		}
		series := root.Bucket(name)
		cursor := series.Cursor()
		for key, _ := cursor.First(); key != nil; key, _ = cursor.Next() {
			at, ok := keyTime(key)
			if !ok || at >= cutoff {
				break
			}
			if err := cursor.Delete(); err != nil {
				return err
			}
		}
		if key, _ := series.Cursor().First(); key == nil {
			empty = append(empty, append([]byte(nil), name...))
		}
		return nil
	}); err != nil {
		return err
	}
	for _, name := range empty {
		if err := root.DeleteBucket(name); err != nil {
			return err
		}
	}
	return nil
}

func SystemSubject() string { return "system" }

func ServiceSubject(group, slug string) string {
	return "service/" + cleanSubject(group) + "/" + cleanSubject(slug)
}

func cleanSubject(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "\x00", "")
	if len(value) > 180 {
		value = value[:180]
	}
	return value
}

func timeKey(at int64) []byte {
	key := make([]byte, 8)
	binary.BigEndian.PutUint64(key, uint64(at))
	return key
}

func keyTime(key []byte) (int64, bool) {
	if len(key) != 8 {
		return 0, false
	}
	return int64(binary.BigEndian.Uint64(key)), true
}

func downsample(points []Point, limit int) []Point {
	if len(points) <= limit || limit < 2 {
		return points
	}
	out := make([]Point, 0, limit)
	last := len(points) - 1
	for i := 0; i < limit; i++ {
		idx := int(float64(i) * float64(last) / float64(limit-1))
		out = append(out, points[idx])
	}
	return out
}
