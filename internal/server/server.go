package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"firewifi/dashboard/internal/deploy"
	"firewifi/dashboard/internal/infra"
	"firewifi/dashboard/internal/server/web"
	"firewifi/dashboard/internal/state"
)

// Re-export the shared types so callers can use server.State / server.Config.
type State = state.State
type Config = state.Config

type StateReader interface {
	Read() (State, error)
}

type ModeSwitcher interface {
	SwitchMode(ctx context.Context, mode string) error
}

type HotspotController interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	Restart(ctx context.Context) error
}

type AppController interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}

type ConfigProvider interface {
	Load() (Config, error)
	Save(Config) error
}

type Server struct {
	State    StateReader
	Switcher ModeSwitcher
	Hotspot  HotspotController
	Syncrox  AppController
	Config   ConfigProvider
	Deploy   *deploy.Manager
	Postgres *infra.Postgres
}

func New(
	st StateReader,
	switcher ModeSwitcher,
	hotspot HotspotController,
	syncrox AppController,
	cfg ConfigProvider,
	dep *deploy.Manager,
	pg *infra.Postgres,
) *Server {
	return &Server{
		State:    st,
		Switcher: switcher,
		Hotspot:  hotspot,
		Syncrox:  syncrox,
		Config:   cfg,
		Deploy:   dep,
		Postgres: pg,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.Handle("/assets/", web.Handler())
	mux.HandleFunc("/", s.handlePage)
	mux.HandleFunc("/api/state", s.handleAPIState)
	mux.HandleFunc("/api/activity", s.handleAPIActivity)
	mux.HandleFunc("/api/files", s.handleAPIFiles)
	mux.HandleFunc("/api/files/preview", s.handleAPIFilesPreview)
	mux.HandleFunc("/api/events", s.handleAPIEvents)
	mux.HandleFunc("/api/mode", s.handleAPIMode)
	mux.HandleFunc("/api/hotspot/start", s.handleHotspot)
	mux.HandleFunc("/api/hotspot/stop", s.handleHotspot)
	mux.HandleFunc("/api/hotspot/restart", s.handleHotspot)
	mux.HandleFunc("/api/syncrox/start", s.handleAppController(func() AppController { return s.Syncrox }))
	mux.HandleFunc("/api/syncrox/stop", s.handleAppController(func() AppController { return s.Syncrox }))
	mux.HandleFunc("/api/config", s.handleAPIConfig)
	mux.HandleFunc("/api/ports", s.handlePorts)
	mux.HandleFunc("/api/github/", s.handleGitHub)
	mux.HandleFunc("/api/github/status", s.handleGitHub)
	mux.HandleFunc("/api/github/token", s.handleGitHub)
	mux.HandleFunc("/api/github/repos", s.handleGitHub)
	mux.HandleFunc("/api/github/branches", s.handleGitHub)
	mux.HandleFunc("/api/infra/postgres/", s.handleInfraPostgres)
	mux.HandleFunc("/api/infra/postgres/status", s.handleInfraPostgres)
	mux.HandleFunc("/api/infra/postgres/start", s.handleInfraPostgres)
	mux.HandleFunc("/api/infra/postgres/stop", s.handleInfraPostgres)
	mux.HandleFunc("/api/manage", s.handleManage)
	mux.HandleFunc("/api/engine", s.handleEngine)
	mux.HandleFunc("/api/docker", s.handleDocker)
	mux.HandleFunc("/api/groups", s.handleGroups)
	mux.HandleFunc("/api/groups/", s.handleGroups)
	mux.HandleFunc("/api/services", s.handleServices)
	mux.HandleFunc("/api/services/", s.handleServices)
	mux.HandleFunc("/api/hooks/", s.handleDeployHooks)
	mux.HandleFunc("/api/hooks/redeploy", s.handleDeployHooks)
	mux.HandleFunc("/api/hooks/github", s.handleDeployHooks)
	return mux
}

func (s *Server) handleAPIActivity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if s.Deploy == nil {
		jsonReply(w, deploy.ActivitySnapshot{Lines: []deploy.ActivityLine{}})
		return
	}
	jsonReply(w, s.Deploy.ActivitySnapshot())
}

func (s *Server) handleAPIEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sendState := func() {
		st, err := s.readShellState()
		if err != nil {
			fmt.Fprintf(w, "event: error\ndata: %s\n\n", strings.ReplaceAll(err.Error(), "\n", " "))
			fl.Flush()
			return
		}
		b, err := json.Marshal(st)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: state\ndata: %s\n\n", b)
		fl.Flush()
	}
	sendActivity := func(snap deploy.ActivitySnapshot) {
		b, err := json.Marshal(snap)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: activity\ndata: %s\n\n", b)
		fl.Flush()
	}

	var actCh <-chan deploy.ActivitySnapshot
	var unsub func()
	if s.Deploy != nil {
		actCh, unsub = s.Deploy.SubscribeActivity()
		defer unsub()
	} else {
		ch := make(chan deploy.ActivitySnapshot)
		close(ch)
		actCh = ch
	}

	sendState()
	if s.Deploy != nil {
		sendActivity(s.Deploy.ActivitySnapshot())
	}

	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	keepAlive := time.NewTicker(20 * time.Second)
	defer keepAlive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case snap, ok := <-actCh:
			if !ok {
				actCh = nil
				continue
			}
			sendActivity(snap)
		case <-tick.C:
			sendState()
		case <-keepAlive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			fl.Flush()
		}
	}
}

func isDashboardPath(path string) bool {
	switch path {
	case "/", "/overview", "/projects", "/settings", "/activity", "/files":
		return true
	}
	if strings.HasPrefix(path, "/projects/") {
		return true
	}
	if strings.HasPrefix(path, "/settings/") {
		return true
	}
	if strings.HasPrefix(path, "/files/") {
		return true
	}
	return false
}

func (s *Server) handlePage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}
	if !isDashboardPath(r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	st, ok := s.readState(w)
	if !ok {
		return
	}
	writePage(w, st)
}

func (s *Server) handleAPIState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	st, ok := s.readState(w)
	if !ok {
		return
	}
	jsonReply(w, st)
}

func (s *Server) handleAPIMode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if !state.ValidMode(body.Mode) {
		http.Error(w, "mode must be mullvad or residential", http.StatusBadRequest)
		return
	}
	if err := s.Switcher.SwitchMode(r.Context(), body.Mode); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	okReply(w)
}

func (s *Server) handleHotspot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var err error
	switch {
	case strings.HasSuffix(r.URL.Path, "/start"):
		err = s.Hotspot.Start(r.Context())
	case strings.HasSuffix(r.URL.Path, "/stop"):
		err = s.Hotspot.Stop(r.Context())
	case strings.HasSuffix(r.URL.Path, "/restart"):
		err = s.Hotspot.Restart(r.Context())
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	okReply(w)
}

func (s *Server) handleAppController(get func() AppController) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		ctrl := get()
		if ctrl == nil {
			http.Error(w, "controller not configured", http.StatusNotImplemented)
			return
		}
		var err error
		if strings.HasSuffix(r.URL.Path, "/start") {
			err = ctrl.Start(r.Context())
		} else if strings.HasSuffix(r.URL.Path, "/stop") {
			err = ctrl.Stop(r.Context())
		} else {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		okReply(w)
	}
}

func (s *Server) handleAPIConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, err := s.Config.Load()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonReply(w, cfg)
	case http.MethodPost, http.MethodPut:
		var cfg Config
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		if err := s.Config.Save(cfg); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		okReply(w)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) readShellState() (State, error) {
	if cr, ok := s.State.(interface{ ReadShellCached() (State, error) }); ok {
		return cr.ReadShellCached()
	}
	return s.State.Read()
}

func (s *Server) readState(w http.ResponseWriter) (State, bool) {
	st, err := s.readShellState()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return State{}, false
	}
	return st, true
}

func methodNotAllowed(w http.ResponseWriter) {
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func okReply(w http.ResponseWriter) {
	jsonReply(w, map[string]bool{"ok": true})
}

func jsonReply(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
