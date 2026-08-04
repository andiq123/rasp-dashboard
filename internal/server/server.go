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
	RepairVPN(ctx context.Context) error
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
	State     StateReader
	Switcher  ModeSwitcher
	Hotspot   HotspotController
	Syncrox   AppController
	Config    ConfigProvider
	Deploy    *deploy.Manager
	Postgres  *infra.Postgres
	vpnRepair *vpnRepairCoordinator
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
	s := &Server{
		State:    st,
		Switcher: switcher,
		Hotspot:  hotspot,
		Syncrox:  syncrox,
		Config:   cfg,
		Deploy:   dep,
		Postgres: pg,
	}
	s.vpnRepair = newVPNRepairCoordinator(st, hotspot)
	return s
}

// StartBackground runs bounded host recovery jobs for the lifetime of ctx.
func (s *Server) StartBackground(ctx context.Context) {
	if s != nil && s.vpnRepair != nil {
		s.vpnRepair.start(ctx)
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
	mux.HandleFunc("/api/hotspot/repair-vpn", s.handleHotspot)
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/ready", s.handleReady)
	mux.HandleFunc("/api/syncrox/start", s.handleAppController(func() AppController { return s.Syncrox }))
	mux.HandleFunc("/api/syncrox/stop", s.handleAppController(func() AppController { return s.Syncrox }))
	mux.HandleFunc("/api/config", s.handleAPIConfig)
	mux.HandleFunc("/api/ports", s.handlePorts)
	mux.HandleFunc("/api/github/", s.handleGitHub)
	mux.HandleFunc("/api/github/status", s.handleGitHub)
	mux.HandleFunc("/api/github/token", s.handleGitHub)
	mux.HandleFunc("/api/github/repos", s.handleGitHub)
	mux.HandleFunc("/api/github/branches", s.handleGitHub)
	mux.HandleFunc("/api/github/dirs", s.handleGitHub)
	mux.HandleFunc("/api/github/ssh-key", s.handleGitHub)
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
	return withOptionalAuth(mux)
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
		st.FilesRoot = filesRoot()
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
	sendServices := func(ev deploy.RegistryEvent) {
		b, err := json.Marshal(ev)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: services\ndata: %s\n\n", b)
		fl.Flush()
	}
	sendStats := func(snap deploy.StatsSnapshot) {
		b, err := json.Marshal(snap)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: stats\ndata: %s\n\n", b)
		fl.Flush()
	}

	var actCh <-chan deploy.ActivitySnapshot
	var unsubAct func()
	var regCh <-chan deploy.RegistryEvent
	var unsubReg func()
	var statsCh <-chan deploy.StatsSnapshot
	var unsubStats func()
	var vpnRepairCh <-chan struct{}
	var unsubVPNRepair func()
	if s.vpnRepair != nil {
		vpnRepairCh, unsubVPNRepair = s.vpnRepair.subscribe()
		defer unsubVPNRepair()
	}
	if s.Deploy != nil {
		actCh, unsubAct = s.Deploy.SubscribeActivity()
		defer unsubAct()
		regCh, unsubReg = s.Deploy.SubscribeRegistry()
		defer unsubReg()
		statsCh, unsubStats = s.Deploy.SubscribeStats()
		defer unsubStats()
	} else {
		ach := make(chan deploy.ActivitySnapshot)
		close(ach)
		actCh = ach
		rch := make(chan deploy.RegistryEvent)
		close(rch)
		regCh = rch
		sch := make(chan deploy.StatsSnapshot)
		close(sch)
		statsCh = sch
	}

	sendState()
	if s.Deploy != nil {
		sendActivity(s.Deploy.ActivitySnapshot())
		sendStats(s.Deploy.StatsSnapshot())
	}

	// State probes are globally cached/singleflight by Reader, so every browser
	// receives fast updates without multiplying WireGuard or egress checks.
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
		case ev, ok := <-regCh:
			if !ok {
				regCh = nil
				continue
			}
			sendServices(ev)
		case snap, ok := <-statsCh:
			if !ok {
				statsCh = nil
				continue
			}
			sendStats(snap)
		case _, ok := <-vpnRepairCh:
			if !ok {
				vpnRepairCh = nil
				continue
			}
			sendState()
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

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	jsonReply(w, map[string]bool{"ok": true})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	st, err := s.readShellState()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	ready := st.HotspotRunning
	if st.Mode == state.ModeMullvad {
		ready = ready && st.VPNHealth.CountryAllowed && st.VPNHealth.InterfaceUp && st.VPNHealth.HandshakeHealthy && st.VPNHealth.EgressOK
	} else {
		ready = ready && st.ProxyRunning
	}
	if !ready {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	jsonReply(w, map[string]interface{}{"ok": ready, "issues": st.Issues, "generated_at": st.GeneratedAt})
}

func (s *Server) handleAPIMode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if !state.ValidMode(body.Mode) {
		http.Error(w, "mode must be mullvad or residential", http.StatusBadRequest)
		return
	}
	if s.vpnRepair != nil {
		s.vpnRepair.cancel("VPN recovery stopped because the route mode changed")
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
		if s.vpnRepair != nil {
			s.vpnRepair.cancel("VPN recovery stopped because the hotspot was stopped")
		}
		err = s.Hotspot.Stop(r.Context())
	case strings.HasSuffix(r.URL.Path, "/restart"):
		err = s.Hotspot.Restart(r.Context())
	case strings.HasSuffix(r.URL.Path, "/repair-vpn"):
		if s.vpnRepair != nil {
			status, _ := s.vpnRepair.trigger(false)
			jsonReply(w, status)
			return
		}
		err = s.Hotspot.RepairVPN(r.Context())
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
		// Never echo the Wi‑Fi password; UI shows a placeholder when set.
		jsonReply(w, Config{
			SSID:        cfg.SSID,
			PasswordSet: cfg.Password != "",
			HotspotIP:   cfg.HotspotIP,
			DHCPStart:   cfg.DHCPStart,
			DHCPEnd:     cfg.DHCPEnd,
		})
	case http.MethodPost, http.MethodPut:
		var cfg Config
		if err := decodeJSONBody(r, &cfg); err != nil {
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
	var st State
	var err error
	if cr, ok := s.State.(interface{ ReadShellCached() (State, error) }); ok {
		st, err = cr.ReadShellCached()
	} else {
		st, err = s.State.Read()
	}
	if err == nil && s.vpnRepair != nil {
		st.VPNRepair = s.vpnRepair.snapshot()
	}
	return st, err
}

func (s *Server) readState(w http.ResponseWriter) (State, bool) {
	st, err := s.readShellState()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return State{}, false
	}
	st.FilesRoot = filesRoot()
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
