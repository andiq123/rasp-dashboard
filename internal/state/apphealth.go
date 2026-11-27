package state

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	appHealthTTL    = 30 * time.Second
	crashWindow     = 10 * time.Minute
	crashLoopAfter  = 3 // restarts inside crashWindow
	appHealthPrefix = "fw-"
)

// AppHealth is one deployed container's stability. Docker restarts crashed
// containers on its own, so a crash loop looks "running"; the restart count
// climbing is the real signal.
type AppHealth struct {
	Container      string `json:"container"`
	Status         string `json:"status"`
	Restarts       int    `json:"restarts"`
	RecentRestarts int    `json:"recent_restarts"`
	ExitCode       int    `json:"exit_code,omitempty"`
	OOMKilled      bool   `json:"oom_killed,omitempty"`
	CrashLoop      bool   `json:"crash_loop,omitempty"`
	LastLog        string `json:"last_log,omitempty"`
}

type appHealthCache struct {
	mu      sync.Mutex
	at      time.Time
	running bool
	apps    []AppHealth
	// Restart count history per container, to measure recent restarts.
	seen map[string][]restartMark
}

type restartMark struct {
	at    time.Time
	count int
}

func (r *Reader) readAppHealth() []AppHealth {
	c := &r.appHealth
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.running && time.Since(c.at) >= appHealthTTL {
		c.running = true
		go func() {
			raw := inspectApps()
			c.mu.Lock()
			now := time.Now()
			if c.seen == nil {
				c.seen = map[string][]restartMark{}
			}
			c.apps = scoreApps(raw, c.seen, now)
			c.at, c.running = now, false
			loops := []string{}
			for _, a := range c.apps {
				if a.CrashLoop {
					loops = append(loops, a.Container)
				}
			}
			c.mu.Unlock()
			// The last log line explains most crashes; only fetched for crashing apps.
			for _, name := range loops {
				line := lastLogLine(name)
				c.mu.Lock()
				for i := range c.apps {
					if c.apps[i].Container == name {
						c.apps[i].LastLog = line
					}
				}
				c.mu.Unlock()
			}
		}()
	}
	return append([]AppHealth(nil), c.apps...)
}

type inspected struct {
	Name         string
	RestartCount int
	State        struct {
		Status     string
		Restarting bool
		OOMKilled  bool
		ExitCode   int
	}
}

func inspectApps() []inspected {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ids, err := exec.CommandContext(ctx, "sudo", "-n", "docker", "ps", "-aq", "--filter", "name="+appHealthPrefix).Output()
	if err != nil || len(strings.TrimSpace(string(ids))) == 0 {
		return nil
	}
	args := append([]string{"-n", "docker", "inspect"}, strings.Fields(string(ids))...)
	out, err := exec.CommandContext(ctx, "sudo", args...).Output()
	if err != nil {
		return nil
	}
	var list []inspected
	_ = json.Unmarshal(out, &list)
	return list
}

// scoreApps turns raw container state into health, using the restart history
// in seen (updated in place) to count restarts inside the crash window.
func scoreApps(list []inspected, seen map[string][]restartMark, now time.Time) []AppHealth {
	apps := make([]AppHealth, 0, len(list))
	alive := map[string]bool{}
	for _, c := range list {
		name := strings.TrimPrefix(c.Name, "/")
		if !strings.HasPrefix(name, appHealthPrefix) {
			continue
		}
		alive[name] = true
		marks := append(seen[name], restartMark{at: now, count: c.RestartCount})
		for len(marks) > 1 && now.Sub(marks[0].at) > crashWindow {
			marks = marks[1:]
		}
		seen[name] = marks
		recent := c.RestartCount - marks[0].count
		if recent < 0 { // container recreated by a deploy
			recent = 0
		}
		status := c.State.Status
		if c.State.Restarting {
			status = "restarting"
		}
		apps = append(apps, AppHealth{
			Container:      name,
			Status:         status,
			Restarts:       c.RestartCount,
			RecentRestarts: recent,
			ExitCode:       c.State.ExitCode,
			OOMKilled:      c.State.OOMKilled,
			CrashLoop:      recent >= crashLoopAfter || (c.State.Restarting && recent > 0),
		})
	}
	for name := range seen {
		if !alive[name] {
			delete(seen, name)
		}
	}
	return apps
}

func lastLogLine(container string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	out, _ := exec.CommandContext(ctx, "sudo", "-n", "docker", "logs", "--tail", "5", container).CombinedOutput()
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); l != "" {
			if len(l) > 240 {
				l = l[:240] + "…"
			}
			return l
		}
	}
	return ""
}
