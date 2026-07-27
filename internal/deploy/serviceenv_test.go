package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOwnEnvBodyStripsActiveLinksOnly(t *testing.T) {
	body := "APP=1\nDATABASE_URL=postgres://x\nDB_HOST=h\nBUCKET=b\nENDPOINT=e\nFOO=bar\n"
	got := ownEnvBody(body, Service{LinkedDatabase: "pg"})
	mp := parseEnvMap(got)
	if mp["APP"] != "1" || mp["FOO"] != "bar" {
		t.Fatalf("own keys lost: %#v", mp)
	}
	if mp["DATABASE_URL"] != "" || mp["DB_HOST"] != "" {
		t.Fatalf("db keys should strip when linked: %#v", mp)
	}
	if mp["BUCKET"] == "" {
		t.Fatal("bucket key should remain when bucket not linked")
	}

	got = ownEnvBody(body, Service{LinkedDatabase: "pg", LinkedBucket: "min"})
	mp = parseEnvMap(got)
	if mp["BUCKET"] != "" || mp["ENDPOINT"] != "" {
		t.Fatalf("bucket keys should strip when linked: %#v", mp)
	}
}

func TestGetServiceEnvGoSeparatesLinked(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	reg := registry{
		Groups: []Group{{Slug: "g", Name: "G"}},
		Services: []Service{
			{Group: "g", Slug: "pg", Type: TypePostgres, Name: "PG"},
			{Group: "g", Slug: "app", Type: TypeGo, Name: "App", LinkedDatabase: "pg"},
		},
	}
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}
	pgDir := m.serviceDir("g", "pg")
	appDir := m.serviceDir("g", "app")
	if err := os.MkdirAll(pgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	pgEnv := postgresServiceEnv("postgres://u:p@127.0.0.1:5432/db", "db", "u", "p")
	if err := os.WriteFile(filepath.Join(pgDir, "env"), []byte(pgEnv), 0o600); err != nil {
		t.Fatal(err)
	}
	// Legacy polluted Go file with linked keys persisted.
	legacy := "PORT=8080\nAPP_SECRET=x\nDATABASE_URL=postgres://old\nDB_HOST=old\n"
	if err := os.WriteFile(filepath.Join(appDir, "env"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}

	view, err := m.GetServiceEnv("g", "app")
	if err != nil {
		t.Fatal(err)
	}
	if view.Kind != "go" {
		t.Fatalf("kind=%q", view.Kind)
	}
	own := parseEnvMap(view.Env)
	if own["APP_SECRET"] != "x" || own["PORT"] != "8080" {
		t.Fatalf("own env: %#v", own)
	}
	if own["DATABASE_URL"] != "" {
		t.Fatal("own env must not include linked DB keys")
	}
	if len(view.Linked) != 1 || view.Linked[0].Kind != "database" || view.Linked[0].Source != "pg" {
		t.Fatalf("linked=%+v", view.Linked)
	}
	linked := parseEnvMap(view.Linked[0].Env)
	if linked["DATABASE_URL"] == "" || linked["DB_USER"] == "" {
		t.Fatalf("linked preview empty: %#v", linked)
	}

	// Migrated file on disk.
	disk, _ := os.ReadFile(filepath.Join(appDir, "env"))
	if parseEnvMap(string(disk))["DATABASE_URL"] != "" {
		t.Fatal("disk file should be migrated without linked keys")
	}
}

func TestGetServiceEnvPostgresIsSelfContained(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir, dir, nil, nil)
	defer m.Close()

	reg := registry{
		Groups:   []Group{{Slug: "g", Name: "G"}},
		Services: []Service{{Group: "g", Slug: "pg", Type: TypePostgres, Name: "PG"}},
	}
	if err := m.saveRegistry(reg); err != nil {
		t.Fatal(err)
	}
	pgDir := m.serviceDir("g", "pg")
	_ = os.MkdirAll(pgDir, 0o755)
	body := postgresServiceEnv("postgres://u:p@127.0.0.1:5432/db", "db", "u", "p")
	_ = os.WriteFile(filepath.Join(pgDir, "env"), []byte(body), 0o600)

	view, err := m.GetServiceEnv("g", "pg")
	if err != nil {
		t.Fatal(err)
	}
	if view.Kind != "postgres" || len(view.Linked) != 0 {
		t.Fatalf("view=%+v", view)
	}
	if parseEnvMap(view.Env)["DATABASE_URL"] == "" {
		t.Fatal("postgres should expose connection env")
	}
}
