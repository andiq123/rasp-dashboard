package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

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
	homeDir := resolveHomeDir()

	r := runner.New(baseDir)
	syncrox := screenapp.New("SYNCROX", filepath.Join(homeDir, "apps", "syncrox"), "syncrox",
		"PORT="+envOr("SYNCROX_PORT", "5090"),
	)
	pg := infra.NewPostgres(baseDir)
	mn := infra.NewMinIO(baseDir)
	dep := deploy.NewManager(baseDir, homeDir, pg, mn)
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

	httpSrv := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
		// No Read/WriteTimeout: SSE and long deploy streams must stay open.
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		dep.Close()
		if err := httpSrv.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()

	log.Printf("FireWifi dashboard at http://localhost:%s", port)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
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

func resolveHomeDir() string {
	if v := os.Getenv("HOME"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		return home
	}
	return "/home/andiq"
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
