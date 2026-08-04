package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRedisServiceEnvAndURL(t *testing.T) {
	body := redisServiceEnv("127.0.0.1", 5103, "s/ecret:yes")
	mp := parseEnvMap(body)
	if mp["REDIS_HOST"] != "127.0.0.1" || mp["REDIS_PORT"] != "5103" || mp["REDIS_PASSWORD"] != "s/ecret:yes" {
		t.Fatalf("unexpected env: %#v", mp)
	}
	if !strings.Contains(mp["REDIS_URL"], "s%2Fecret%3Ayes") || !strings.HasSuffix(mp["REDIS_URL"], "/0") {
		t.Fatalf("password must be URL encoded: %q", mp["REDIS_URL"])
	}
}

func TestRedisConnectionURLIsNotPersistedInRegistryOrMeta(t *testing.T) {
	dir := t.TempDir()
	m := &Manager{DeployDir: dir}
	svc := Service{
		Group: "g", Slug: "cache", Name: "Cache", Type: TypeRedis,
		ConnectionURL: "redis://default:secret@127.0.0.1:5100/0",
	}
	if err := m.saveRegistry(registry{Groups: []Group{{Slug: "g", Name: "G"}}, Services: []Service{svc}}); err != nil {
		t.Fatal(err)
	}
	if err := m.writeMeta(svc); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		filepath.Join(dir, "registry.json"),
		filepath.Join(m.serviceDir("g", "cache"), "meta.json"),
	} {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(body), "secret") {
			t.Fatalf("credential leaked into %s", path)
		}
	}
}

func TestRedisLinkSpecClearsStaleValues(t *testing.T) {
	src := parseEnvMap(redisServiceEnv("127.0.0.1", 5104, "new-secret"))
	body := "FOO=bar\nREDIS_PASSWORD=old\nREDIS_PORT=9999\n"
	got := (&Manager{}).injectLinkedServiceEnvFrom(body, "g", "cache", src, redisLinkSpec())
	mp := parseEnvMap(got)
	if mp["FOO"] != "bar" || mp["REDIS_PASSWORD"] != "new-secret" || mp["REDIS_PORT"] != "5104" {
		t.Fatalf("unexpected linked env: %#v", mp)
	}
}
