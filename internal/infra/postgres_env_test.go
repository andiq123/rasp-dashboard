package infra

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// The compose .env is shared by Postgres and MinIO. Switching the Postgres
// image must keep the MinIO root credentials stored next to it.
func TestSetImageKeepsMinIOCredentials(t *testing.T) {
	base := t.TempDir()
	p := NewPostgres(base)
	mn := NewMinIO(base)
	if err := os.MkdirAll(filepath.Dir(p.EnvFile()), 0o755); err != nil {
		t.Fatal(err)
	}
	seed := "POSTGRES_IMAGE=postgres:16-alpine\nMINIO_ROOT_USER=firewifi\nMINIO_ROOT_PASSWORD=s3cr3t-root\n"
	if err := os.WriteFile(p.EnvFile(), []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}

	// A cancelled context stops before any docker command runs; the env file
	// is written first, which is the part under test.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_ = p.SetImage(ctx, "postgres:17-alpine")

	if got := p.Image(); got != "postgres:17-alpine" {
		t.Fatalf("image = %q, want postgres:17-alpine", got)
	}
	env, err := readDotEnv(mn.EnvFile)
	if err != nil {
		t.Fatal(err)
	}
	if env["MINIO_ROOT_PASSWORD"] != "s3cr3t-root" || env["MINIO_ROOT_USER"] != "firewifi" {
		t.Fatalf("MinIO credentials lost after SetImage: %v", env)
	}
}
