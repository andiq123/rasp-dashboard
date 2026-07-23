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
	if len(ak) > maxMinioAccessKeyLen {
		t.Fatalf("access key too long: %q (%d)", ak, len(ak))
	}
	if ak != "fwb-driver-logs-buch" {
		t.Fatalf("access key=%q", ak)
	}
	if pol != "fwb-driver-logs-buchet-policy" {
		t.Fatalf("policy=%q", pol)
	}
	ak2, _ := bucketIAMNames("driver-logs-buchet")
	if ak2 != ak {
		t.Fatal("not deterministic")
	}
}
