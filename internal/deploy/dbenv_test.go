package deploy

import "testing"

func TestInjectDatabaseURL(t *testing.T) {
	raw := "postgres://myuser:s3cret@127.0.0.1:5432/mydb?sslmode=disable"
	out := injectDatabaseURL("", raw)
	m := parseEnvMap(out)
	if m["DATABASE_URL"] != raw {
		t.Fatalf("url %q", m["DATABASE_URL"])
	}
	if m["DB_HOST"] != "127.0.0.1" || m["DB_PORT"] != "5432" || m["DB_NAME"] != "mydb" {
		t.Fatalf("parts %+v", m)
	}
	if m["DB_USER"] != "myuser" || m["DB_PASSWORD"] != "s3cret" || m["DB_SSLMODE"] != "disable" {
		t.Fatalf("auth %+v", m)
	}
	cleared := removeLinkedDBEnv(out)
	if parseEnvMap(cleared)["DB_HOST"] != "" || parseEnvMap(cleared)["DATABASE_URL"] != "" {
		t.Fatalf("remove failed %q", cleared)
	}
}
