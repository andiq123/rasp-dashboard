package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveEnvRefs(t *testing.T) {
	root := t.TempDir()
	m := &Manager{DeployDir: root}
	group := "demo"
	bucketDir := filepath.Join(root, "groups", group, "uploads")
	if err := os.MkdirAll(bucketDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := bucketServiceEnv("my-bucket", "http://127.0.0.1:9000", "ak", "sk")
	if err := os.WriteFile(filepath.Join(bucketDir, "env"), []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	app := ""
	app = upsertEnv(app, "BUCKET", refExpr("uploads", "BUCKET"))
	app = upsertEnv(app, "ENDPOINT", refExpr("uploads", "ENDPOINT"))
	app = upsertEnv(app, "JWT_SECRET", "already-set")
	got := m.resolveEnvRefs(group, app)
	mp := parseEnvMap(got)
	if mp["BUCKET"] != "my-bucket" || mp["ENDPOINT"] != "http://127.0.0.1:9000" {
		t.Fatalf("%#v", mp)
	}
	if mp["JWT_SECRET"] != "already-set" {
		t.Fatal("unrelated key changed")
	}
}

func TestInjectLinkedBucketCopies(t *testing.T) {
	root := t.TempDir()
	m := &Manager{DeployDir: root}
	group := "demo"
	bucketDir := filepath.Join(root, "groups", group, "uploads")
	if err := os.MkdirAll(bucketDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bucketDir, "env"), []byte(bucketServiceEnv("b1", "http://127.0.0.1:9000", "a", "s")), 0o600); err != nil {
		t.Fatal(err)
	}
	out := m.injectLinkedBucket("CORS=https://app.example/\n", group, "uploads")
	mp := parseEnvMap(out)
	if mp["CORS"] != "https://app.example/" {
		t.Fatalf("lost CORS: %#v", mp)
	}
	if mp["BUCKET"] != "b1" {
		t.Fatalf("BUCKET = %q want concrete", mp["BUCKET"])
	}
	if mp["ACCESS_KEY_ID"] != "a" || mp["SECRET_ACCESS_KEY"] != "s" {
		t.Fatalf("keys %#v", mp)
	}
	if mp["FORCE_PATH_STYLE"] != "true" {
		t.Fatalf("FORCE_PATH_STYLE = %q", mp["FORCE_PATH_STYLE"])
	}
	if mp["REGION"] != "" {
		t.Fatal("REGION should not be injected")
	}
}

func TestInjectLinkedDatabaseCopies(t *testing.T) {
	root := t.TempDir()
	m := &Manager{DeployDir: root}
	group := "demo"
	dbDir := filepath.Join(root, "groups", group, "db")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := postgresServiceEnv("postgres://u:p@127.0.0.1:5432/demo?sslmode=disable", "demo", "u", "p")
	if err := os.WriteFile(filepath.Join(dbDir, "env"), []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	out := m.injectLinkedDatabase("APP=1\n", group, "db")
	mp := parseEnvMap(out)
	if mp["APP"] != "1" {
		t.Fatalf("lost APP %#v", mp)
	}
	if mp["DB_NAME"] != "demo" || mp["POSTGRES_DB"] != "demo" {
		t.Fatalf("db name %#v", mp)
	}
	if strings.Contains(mp["DB_PASSWORD"], "${{") {
		t.Fatalf("password still a ref: %q", mp["DB_PASSWORD"])
	}
}
