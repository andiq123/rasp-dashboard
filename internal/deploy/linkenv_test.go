package deploy

import "testing"

func TestRedeployGoRequestIncludesLinks(t *testing.T) {
	svc := Service{
		Repo: "acme/app", Branch: "main", Name: "App",
		LinkedDatabase: "pg", LinkedBucket: "buchet", LinkedRedis: "cache",
		RootDir: "backend", BuildCmd: "make", GoToolchain: "1.22",
		MemoryMB: 512, CPUs: 1,
	}
	got := redeployGoRequest(svc)
	if got.LinkedBucket != "buchet" {
		t.Fatalf("LinkedBucket=%q want buchet", got.LinkedBucket)
	}
	if got.LinkedDatabase != "pg" {
		t.Fatalf("LinkedDatabase=%q want pg", got.LinkedDatabase)
	}
	if got.LinkedRedis != "cache" {
		t.Fatalf("LinkedRedis=%q want cache", got.LinkedRedis)
	}
	if got.Repo != "acme/app" || got.RootDir != "backend" {
		t.Fatalf("unexpected request: %+v", got)
	}
}

func TestApplyClearLinkedRedisStripsKeys(t *testing.T) {
	body := "FOO=bar\nREDIS_URL=redis://default:secret@127.0.0.1:5100/0\nREDIS_HOST=127.0.0.1\nREDIS_PASSWORD=secret\n"
	svc := Service{Group: "g", Slug: "app", LinkedRedis: "cache", Type: TypeGo}
	got, out := applyClearLinkedRedis(svc, body)
	if got.LinkedRedis != "" {
		t.Fatalf("LinkedRedis not cleared: %q", got.LinkedRedis)
	}
	mp := parseEnvMap(out)
	if mp["FOO"] != "bar" {
		t.Fatalf("custom key lost: %#v", mp)
	}
	for _, key := range linkedRedisKeys {
		if mp[key] != "" {
			t.Fatalf("%s still present", key)
		}
	}
}

func TestApplyClearLinkedBucketStripsKeys(t *testing.T) {
	body := "FOO=bar\nBUCKET=demo\nENDPOINT=http://127.0.0.1:9000\nACCESS_KEY_ID=k\nSECRET_ACCESS_KEY=s\nFORCE_PATH_STYLE=true\n"
	svc := Service{Group: "g", Slug: "app", LinkedBucket: "buchet", Type: TypeGo}
	got, out := applyClearLinkedBucket(svc, body)
	if got.LinkedBucket != "" {
		t.Fatalf("LinkedBucket not cleared: %q", got.LinkedBucket)
	}
	mp := parseEnvMap(out)
	if mp["FOO"] != "bar" {
		t.Fatalf("custom key lost: %#v", mp)
	}
	for _, k := range []string{"BUCKET", "ENDPOINT", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "FORCE_PATH_STYLE"} {
		if mp[k] != "" {
			t.Fatalf("%s still present", k)
		}
	}
}

func TestApplyClearLinkedDatabaseStripsKeys(t *testing.T) {
	body := "FOO=bar\nDATABASE_URL=postgres://u:p@h/db\nDB_HOST=h\nDB_USER=u\n"
	svc := Service{Group: "g", Slug: "app", LinkedDatabase: "pg", Type: TypeGo}
	got, out := applyClearLinkedDatabase(svc, body)
	if got.LinkedDatabase != "" {
		t.Fatalf("LinkedDatabase not cleared: %q", got.LinkedDatabase)
	}
	mp := parseEnvMap(out)
	if mp["FOO"] != "bar" {
		t.Fatalf("custom key lost: %#v", mp)
	}
	if mp["DATABASE_URL"] != "" || mp["DB_HOST"] != "" {
		t.Fatalf("db keys remain: %#v", mp)
	}
}
