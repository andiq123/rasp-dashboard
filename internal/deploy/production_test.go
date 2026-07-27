package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultGoBuildCmd(t *testing.T) {
	got := defaultGoBuildCmd("./cmd")
	for _, want := range []string{"CGO_ENABLED=0", "-trimpath", `-ldflags="-s -w"`, "-buildvcs=false", "-o /out/app", "./cmd"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
}

func TestProductionizeBuildCmd(t *testing.T) {
	got, err := productionizeBuildCmd("go build -o /out/app ./cmd")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"CGO_ENABLED=0", "-trimpath", `-ldflags="-s -w"`, "-buildvcs=false", "/out/app", "./cmd"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
	if _, err := productionizeBuildCmd("go build -race -o /out/app ."); err == nil {
		t.Fatal("expected -race rejection")
	}
}

func TestEnsureProductionEnvGoOnly(t *testing.T) {
	after := ensureProductionEnv("PORT=5100\nAPP_ENV=development\nGIN_MODE=debug\nNODE_ENV=development\n", envStackHints{Go: true, Gin: true})
	m := parseEnvMap(after)
	if m["APP_ENV"] != "production" {
		t.Fatalf("APP_ENV=%q", m["APP_ENV"])
	}
	if m["GO_ENV"] != "production" {
		t.Fatalf("GO_ENV=%q", m["GO_ENV"])
	}
	if m["GIN_MODE"] != "release" {
		t.Fatalf("GIN_MODE=%q", m["GIN_MODE"])
	}
	if m["NODE_ENV"] != "" {
		t.Fatalf("NODE_ENV must not stick without Node hint: %q", m["NODE_ENV"])
	}
	if m["PORT"] != "5100" {
		t.Fatalf("PORT=%q", m["PORT"])
	}
}

func TestEnsureProductionEnvPureGoNoNode(t *testing.T) {
	after := ensureProductionEnv("PORT=5100\nGIN_MODE=release\nNODE_ENV=production\n", envStackHints{Go: true})
	m := parseEnvMap(after)
	if m["APP_ENV"] != "production" || m["GO_ENV"] != "production" {
		t.Fatalf("want APP_ENV/GO_ENV production: %#v", m)
	}
	if m["NODE_ENV"] != "" || m["GIN_MODE"] != "" {
		t.Fatalf("must strip invented NODE_ENV/GIN_MODE: %#v", m)
	}
}

func TestEnsureProductionEnvPostgresStripsFramework(t *testing.T) {
	body := postgresServiceEnv("postgres://u:p@127.0.0.1:5432/db", "db", "u", "p")
	body = upsertEnv(body, "APP_ENV", "production")
	body = upsertEnv(body, "NODE_ENV", "production")
	body = upsertEnv(body, "GIN_MODE", "release")
	body = upsertEnv(body, "GO_ENV", "production")
	after := ensureProductionEnv(body, envStackHints{})
	m := parseEnvMap(after)
	for _, k := range frameworkEnvKeys {
		if m[k] != "" {
			t.Fatalf("%s should be stripped from postgres: %#v", k, m)
		}
	}
	if m["DATABASE_URL"] == "" || m["DB_NAME"] == "" {
		t.Fatalf("connection keys lost: %#v", m)
	}
}

func TestSanitizeServiceEnv(t *testing.T) {
	dirty := "DATABASE_URL=x\nAPP_ENV=production\nNODE_ENV=production\n"
	got := sanitizeServiceEnv(dirty, TypePostgres, envStackHints{})
	m := parseEnvMap(got)
	if m["APP_ENV"] != "" || m["NODE_ENV"] != "" {
		t.Fatalf("framework keys remain: %#v", m)
	}
	if m["DATABASE_URL"] != "x" {
		t.Fatalf("db url lost: %#v", m)
	}
}

func TestDetectEnvStackHints(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module x\n\nrequire github.com/gin-gonic/gin v1.9.0\n"), 0o644)
	h := detectEnvStackHints(dir)
	if !h.Go || !h.Gin || h.Node {
		t.Fatalf("hints=%+v", h)
	}
	_ = os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"x"}`), 0o644)
	h = detectEnvStackHints(dir)
	if !h.Node {
		t.Fatal("expected Node from package.json")
	}
}
