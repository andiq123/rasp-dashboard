package server

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"firewifi/dashboard/internal/monitor"
)

const monitorInterval = 30 * time.Second

func (s *Server) monitorHistory(ctx context.Context) {
	// Let CPU/network delta metrics warm after process startup.
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		_ = s.History.Close()
		return
	case <-timer.C:
	}
	s.recordHistory()

	sampleTick := time.NewTicker(monitorInterval)
	defer sampleTick.Stop()
	defer s.History.Close()
	for {
		select {
		case <-ctx.Done():
			return
		case <-sampleTick.C:
			s.recordHistory()
		}
	}
}

func (s *Server) recordHistory() {
	if s == nil || s.History == nil {
		return
	}
	now := time.Now().Unix()
	samples := make([]monitor.Sample, 0, 16)
	if st, err := s.readShellState(); err == nil {
		metrics := st.DeviceMetrics
		samples = append(samples, monitor.Sample{
			Subject: monitor.SystemSubject(),
			Point: monitor.Point{
				At: now, CPUPercent: metrics.CPU.BusyPercent,
				MemoryMB:      float64(metrics.Memory.UsedBytes) / (1024 * 1024),
				MemoryPercent: metrics.Memory.UsedPercent,
				TemperatureC:  metrics.Thermal.TemperatureCelsius,
				DiskPercent:   metrics.Storage.UsedPercent,
				DownBPS:       metrics.Network.DownBytesPerSec,
				UpBPS:         metrics.Network.UpBytesPerSec,
				Running:       true,
			},
		})
	}
	if s.Deploy != nil {
		for _, svc := range s.Deploy.MonitorServices() {
			point := monitor.Point{At: now, Running: svc.Running}
			if svc.Stats != nil {
				point.CPUPercent = svc.Stats.CPUPercent
				point.MemoryMB = svc.Stats.MemoryMB
				point.PIDs = svc.Stats.PIDs
				point.Running = true
			}
			samples = append(samples, monitor.Sample{
				Subject: monitor.ServiceSubject(svc.Group, svc.Slug), Point: point,
			})
		}
	}
	if err := s.History.Put(samples); err != nil {
		// The next tick retries; monitoring must never impact dashboard uptime.
		return
	}
}

func historyWindow(value string) time.Duration {
	switch value {
	case "1h":
		return time.Hour
	case "24h":
		return 24 * time.Hour
	case "7d":
		return 7 * 24 * time.Hour
	default:
		return 6 * time.Hour
	}
}

func (s *Server) historyReply(w http.ResponseWriter, r *http.Request, subject string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if s.History == nil {
		http.Error(w, "monitor history unavailable", http.StatusServiceUnavailable)
		return
	}
	limit := 240
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	series, err := s.History.Query(subject, time.Now().Add(-historyWindow(r.URL.Query().Get("range"))), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonReply(w, series)
}

func (s *Server) handleSystemHistory(w http.ResponseWriter, r *http.Request) {
	s.historyReply(w, r, monitor.SystemSubject())
}

// AppSeries is one deployed app's history, light enough to send for every app.
type AppSeries struct {
	Group  string     `json:"group"`
	Slug   string     `json:"slug"`
	Name   string     `json:"name"`
	Type   string     `json:"type"`
	Shared bool       `json:"shared,omitempty"`
	Points []AppPoint `json:"points"`
}

type AppPoint struct {
	At         int64   `json:"at"`
	CPUPercent float64 `json:"cpu_percent"`
	MemoryMB   float64 `json:"memory_mb"`
}

// handleAppsHistory returns every app's CPU and memory over a range, so the
// dashboard can rank consumers and say which app caused a system spike.
func (s *Server) handleAppsHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if s.History == nil || s.Deploy == nil {
		http.Error(w, "monitor history unavailable", http.StatusServiceUnavailable)
		return
	}
	limit := 240
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	since := time.Now().Add(-historyWindow(r.URL.Query().Get("range")))
	apps := make([]AppSeries, 0, 8)
	for _, svc := range s.Deploy.MonitorServices() {
		series, err := s.History.Query(monitor.ServiceSubject(svc.Group, svc.Slug), since, limit)
		if err != nil || len(series.Points) == 0 {
			continue
		}
		app := AppSeries{Group: svc.Group, Slug: svc.Slug, Name: svc.Name, Type: svc.Type, Shared: svc.Stats != nil && svc.Stats.Shared}
		if app.Name == "" {
			app.Name = svc.Slug
		}
		app.Points = make([]AppPoint, len(series.Points))
		for i, p := range series.Points {
			app.Points[i] = AppPoint{At: p.At, CPUPercent: p.CPUPercent, MemoryMB: p.MemoryMB}
		}
		apps = append(apps, app)
	}
	jsonReply(w, map[string]any{"apps": apps})
}
