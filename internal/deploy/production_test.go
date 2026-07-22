package deploy

import (
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

func TestEnsureProductionEnv(t *testing.T) {
	after := ensureProductionEnv("PORT=5100\nAPP_ENV=development\nGIN_MODE=debug\n")
	m := parseEnvMap(after)
	if m["APP_ENV"] != "production" {
		t.Fatalf("APP_ENV=%q", m["APP_ENV"])
	}
	if m["GIN_MODE"] != "release" {
		t.Fatalf("GIN_MODE=%q", m["GIN_MODE"])
	}
	if m["NODE_ENV"] != "production" {
		t.Fatalf("NODE_ENV=%q", m["NODE_ENV"])
	}
	if m["GO_ENV"] != "production" {
		t.Fatalf("GO_ENV=%q", m["GO_ENV"])
	}
	if m["PORT"] != "5100" {
		t.Fatalf("PORT=%q", m["PORT"])
	}
}
