package deploy

import "testing"

func TestBucketEnvInjectRemove(t *testing.T) {
	body := bucketServiceEnv("demo-bucket", "http://127.0.0.1:9000", "key", "secret")
	mp := parseEnvMap(body)
	want := "http://key:secret@127.0.0.1:9000/demo-bucket"
	if mp["BUCKET_URL"] != want {
		t.Fatalf("BUCKET_URL = %q, want %q", mp["BUCKET_URL"], want)
	}
	if len(mp) != 1 {
		t.Fatalf("expected only BUCKET_URL, got %#v", mp)
	}
	cleared := removeLinkedBucketEnv(body)
	if parseEnvMap(cleared)["BUCKET_URL"] != "" {
		t.Fatal("BUCKET_URL not removed")
	}
}

func TestInjectBucketPreservesOtherKeys(t *testing.T) {
	body := injectBucketCreds("FOO=bar\nPORT=5100\n", "b1", "http://127.0.0.1:9000", "a", "s", "")
	mp := parseEnvMap(body)
	if mp["FOO"] != "bar" || mp["PORT"] != "5100" || mp["BUCKET_URL"] == "" {
		t.Fatalf("%#v", mp)
	}
}

func TestParseBuildBucketURL(t *testing.T) {
	raw := buildBucketURL("http://127.0.0.1:9000", "ak", "sk/with=special", "my-bucket")
	ep, ak, sk, b := parseBucketURL(raw)
	if ep != "http://127.0.0.1:9000" || ak != "ak" || sk != "sk/with=special" || b != "my-bucket" {
		t.Fatalf("roundtrip: ep=%q ak=%q sk=%q b=%q raw=%q", ep, ak, sk, b, raw)
	}
}

func TestBucketURLFromLegacyMap(t *testing.T) {
	u := bucketURLFromEnvMap(map[string]string{
		"BUCKET":                   "b",
		"BUCKET_ENDPOINT":          "http://127.0.0.1:9000",
		"BUCKET_ACCESS_KEY_ID":     "a",
		"BUCKET_SECRET_ACCESS_KEY": "s",
	})
	if u != "http://a:s@127.0.0.1:9000/b" {
		t.Fatalf("got %q", u)
	}
}

func TestRemoveLegacyBucketKeys(t *testing.T) {
	body := "FOO=1\nBUCKET=old\nAWS_REGION=us-east-1\nBUCKET_URL=http://a:b@127.0.0.1:9000/x\n"
	mp := parseEnvMap(removeLinkedBucketEnv(body))
	if mp["FOO"] != "1" || mp["BUCKET"] != "" || mp["BUCKET_URL"] != "" {
		t.Fatalf("%#v", mp)
	}
}
