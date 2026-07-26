package infra

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBucketPolicyJSON_arns(t *testing.T) {
	raw := bucketPolicyJSON("driver-logs-buchet")
	var doc struct {
		Version   string `json:"Version"`
		Statement []struct {
			Effect   string   `json:"Effect"`
			Action   []string `json:"Action"`
			Resource []string `json:"Resource"`
		} `json:"Statement"`
	}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, raw)
	}
	if doc.Version != "2012-10-17" || len(doc.Statement) != 1 {
		t.Fatalf("unexpected policy: %+v", doc)
	}
	st := doc.Statement[0]
	if st.Effect != "Allow" || len(st.Action) != 1 || st.Action[0] != "s3:*" {
		t.Fatalf("unexpected statement: %+v", st)
	}
	want := []string{
		"arn:aws:s3:::driver-logs-buchet",
		"arn:aws:s3:::driver-logs-buchet/*",
	}
	if strings.Join(st.Resource, ",") != strings.Join(want, ",") {
		t.Fatalf("resources=%v want %v", st.Resource, want)
	}
}

func TestBucketIAMNames_deterministicAndLengthSafe(t *testing.T) {
	ak, pol := bucketIAMNames("driver-logs-buchet")
	if !strings.HasPrefix(ak, "fwb-") {
		t.Fatalf("access key prefix: %q", ak)
	}
	if len(ak) != maxMinioAccessKeyLen {
		t.Fatalf("access key len=%d want %d (%q)", len(ak), maxMinioAccessKeyLen, ak)
	}
	ak2, pol2 := bucketIAMNames("driver-logs-buchet")
	if ak2 != ak || pol2 != pol {
		t.Fatal("not deterministic")
	}
	// Distinct buckets must never share an access key (old truncate scheme did).
	akOther, _ := bucketIAMNames("driver-logs-buchet-extra")
	if akOther == ak {
		t.Fatalf("access key collision: %q", ak)
	}
	if !strings.HasPrefix(pol, "fwb-") || !strings.HasSuffix(pol, "-policy") {
		t.Fatalf("policy=%q", pol)
	}
}

func TestBucketIAMNamesLegacy_cleanupShape(t *testing.T) {
	ak, pol := bucketIAMNamesLegacy("driver-logs-buchet")
	if ak != "fwb-driver-logs-buch" || pol != "fwb-driver-logs-buchet-policy" {
		t.Fatalf("legacy ak=%q pol=%q", ak, pol)
	}
}
