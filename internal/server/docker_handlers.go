package server

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"firewifi/dashboard/internal/deploy"
)

func (s *Server) handleManage(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ov, err := manageCache.get(r.Context(), s.Deploy)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	jsonReply(w, ov)
}

const (
	manageFresh = 15 * time.Second // serve without refreshing
	manageStale = 2 * time.Minute  // serve instantly while refreshing in the background
)

// manageOverviewCache keeps the slow Docker overview (docker system df and
// friends take seconds on a Pi) so the Settings page opens instantly.
type manageOverviewCache struct {
	mu         sync.Mutex
	at         time.Time
	val        deploy.ManageOverview
	refreshing bool
}

var manageCache = &manageOverviewCache{}

func (c *manageOverviewCache) get(ctx context.Context, m *deploy.Manager) (deploy.ManageOverview, error) {
	c.mu.Lock()
	age := time.Since(c.at)
	if !c.at.IsZero() && age < manageStale {
		val := c.val
		if age >= manageFresh && !c.refreshing {
			c.refreshing = true
			go func() {
				fresh, err := m.ManageOverview(context.Background())
				c.mu.Lock()
				if err == nil {
					c.val, c.at = fresh, time.Now()
				}
				c.refreshing = false
				c.mu.Unlock()
			}()
		}
		c.mu.Unlock()
		return val, nil
	}
	c.mu.Unlock()
	val, err := m.ManageOverview(ctx)
	if err == nil && ctx.Err() == nil {
		c.mu.Lock()
		c.val, c.at = val, time.Now()
		c.mu.Unlock()
	}
	return val, err
}

// invalidate drops the cache after a Docker action so the next read is fresh.
func (c *manageOverviewCache) invalidate() {
	c.mu.Lock()
	c.at = time.Time{}
	c.mu.Unlock()
}

func (s *Server) handleDocker(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	switch {
	case r.URL.Path == "/api/docker" && r.Method == http.MethodGet:
		inv, err := s.Deploy.DockerInventory(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, inv)
	case r.URL.Path == "/api/docker" && r.Method == http.MethodPost:
		var act deploy.DockerAction
		if err := decodeJSONBody(r, &act); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		res, err := s.Deploy.DockerDo(r.Context(), act)
		manageCache.invalidate()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, res)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleEngine(w http.ResponseWriter, r *http.Request) {
	if s.Deploy == nil {
		http.Error(w, "deploy not configured", http.StatusNotImplemented)
		return
	}
	switch r.Method {
	case http.MethodGet:
		jsonReply(w, s.Deploy.EngineView(r.Context()))
	case http.MethodPut, http.MethodPost:
		var body struct {
			Action          string `json:"action"`
			PostgresVersion string `json:"postgres_version"`
			GoToolchain     string `json:"go_toolchain"`
		}
		if err := decodeJSONBody(r, &body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		action := strings.ToLower(strings.TrimSpace(body.Action))
		switch action {
		case "start":
			view, err := s.Deploy.StartPostgresEngine(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, view)
			return
		case "stop":
			view, err := s.Deploy.StopPostgresEngine(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, view)
			return
		case "minio_start":
			view, err := s.Deploy.StartMinIOEngine(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, view)
			return
		case "minio_stop":
			view, err := s.Deploy.StopMinIOEngine(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, view)
			return
		case "", "update":
			view, err := s.Deploy.UpdateEngine(r.Context(), deploy.EngineSettings{
				PostgresVersion: body.PostgresVersion,
				GoToolchain:     body.GoToolchain,
			})
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			jsonReply(w, view)
			return
		default:
			http.Error(w, "unknown action", http.StatusBadRequest)
			return
		}
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
