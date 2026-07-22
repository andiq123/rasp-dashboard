package deploy

import (
	"os"
	"path/filepath"
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

func TestInjectLinkedBucketRefs(t *testing.T) {
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
	if mp["BUCKET"] != "${{uploads.BUCKET}}" {
		t.Fatalf("BUCKET ref = %q", mp["BUCKET"])
	}
	if mp["ACCESS_KEY_ID"] != "${{uploads.ACCESS_KEY_ID}}" {
		t.Fatalf("ACCESS_KEY_ID ref = %q", mp["ACCESS_KEY_ID"])
	}
	if mp["FORCE_PATH_STYLE"] != "true" {
		t.Fatalf("FORCE_PATH_STYLE = %q", mp["FORCE_PATH_STYLE"])
	}
	if mp["REGION"] != "" {
		t.Fatal("REGION should not be injected")
	}
	resolved := parseEnvMap(m.resolveEnvRefs(group, out))
	if resolved["BUCKET"] != "b1" || resolved["ACCESS_KEY_ID"] != "a" {
		t.Fatalf("resolve %#v", resolved)
	}
}
