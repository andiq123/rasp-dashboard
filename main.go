package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"firewifi/dashboard/internal/deploy"
	"firewifi/dashboard/internal/infra"
	"firewifi/dashboard/internal/runner"
	"firewifi/dashboard/internal/screenapp"
	"firewifi/dashboard/internal/server"
	"firewifi/dashboard/internal/state"
)

func main() {
	baseDir := resolveBaseDir()
	port := envOr("PORT", "8484")
	homeDir := envOr("HOME", "/home/andiq")

	r := runner.New(baseDir)
	syncrox := screenapp.New("SYNCROX", "/home/andiq/apps/syncrox", "syncrox",
		"PORT="+envOr("SYNCROX_PORT", "5090"),
	)
	pg := infra.NewPostgres(baseDir)
	dep := deploy.NewManager(baseDir, homeDir, pg)
	dep.RecoverInterruptedDeploys(nil)

	srv := server.New(
		state.NewReader(baseDir),
		r,
		r,
		syncrox,
		&configAdapter{baseDir},
		dep,
		pg,
	)

	log.Printf("FireWifi dashboard at http://localhost:%s", port)
	if err := http.ListenAndServe("0.0.0.0:"+port, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}

func resolveBaseDir() string {
	base := envOr("FIREWIFI_BASE", ".")
	abs, err := filepath.Abs(base)
	if err != nil {
		log.Fatal(err)
	}
	return abs
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type configAdapter struct{ baseDir string }

func (a *configAdapter) Load() (server.Config, error) { return state.LoadConfig(a.baseDir) }
func (a *configAdapter) Save(c server.Config) error   { return state.SaveConfig(a.baseDir, c) }
