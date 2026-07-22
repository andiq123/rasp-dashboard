package deploy

import "testing"

func TestPhysicalBucketName(t *testing.T) {
	cases := []struct{ group, slug, want string }{
		{"driver-logs", "uploads", "driver-logs-uploads"},
		{"driver-logs", "driver-logs", "driver-logs"},
		{"driver-logs", "driver-logs-files", "driver-logs-files"},
		{"find-vibe", "media", "find-vibe-media"},
		{"", "uploads", "uploads"},
	}
	for _, c := range cases {
		got := physicalBucketName(c.group, c.slug)
		if got != c.want {
			t.Fatalf("physicalBucketName(%q,%q)=%q want %q", c.group, c.slug, got, c.want)
		}
	}
}

func TestBucketEnvInjectRemove(t *testing.T) {
	body := bucketServiceEnv("demo-bucket", "http://127.0.0.1:9000", "key", "secret")
	mp := parseEnvMap(body)
	want := map[string]string{
		"BUCKET":            "demo-bucket",
		"ENDPOINT":          "http://127.0.0.1:9000",
		"ACCESS_KEY_ID":     "key",
		"SECRET_ACCESS_KEY": "secret",
	}
	for k, v := range want {
		if mp[k] != v {
			t.Fatalf("%s = %q, want %q", k, mp[k], v)
		}
	}
	if mp["REGION"] != "" || mp["FORCE_PATH_STYLE"] != "" || mp["BUCKET_URL"] != "" {
		t.Fatalf("unexpected extras %#v", mp)
	}
	cleared := removeLinkedBucketEnv(body)
	cm := parseEnvMap(cleared)
	for _, k := range []string{"BUCKET", "ENDPOINT", "ACCESS_KEY_ID"} {
		if cm[k] != "" {
			t.Fatalf("%s not removed", k)
		}
	}
}

func TestInjectBucketPreservesOtherKeys(t *testing.T) {
	body := injectBucketCreds("FOO=bar\n", "b1", "http://127.0.0.1:9000", "a", "s", "")
	mp := parseEnvMap(body)
	if mp["FOO"] != "bar" || mp["BUCKET"] != "b1" {
		t.Fatalf("%#v", mp)
	}
}

func TestParseBuildBucketURL(t *testing.T) {
	raw := buildBucketURL("http://127.0.0.1:9000", "ak", "sk/with=special", "my-bucket")
	ep, ak, sk, b := parseBucketURL(raw)
	if ep != "http://127.0.0.1:9000" || ak != "ak" || sk != "sk/with=special" || b != "my-bucket" {
		t.Fatalf("roundtrip failed raw=%q", raw)
	}
}
