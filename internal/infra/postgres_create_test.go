package infra

import (
	"strings"
	"testing"
)

func TestCreateDatabaseStmts_revokesPublicConnect(t *testing.T) {
	stmts := createDatabaseStmts("demo_db", "demo_db_user", "s3cret")
	joined := strings.Join(stmts, "\n")
	want := []string{
		"REVOKE CONNECT ON DATABASE demo_db FROM PUBLIC",
		"GRANT CONNECT ON DATABASE demo_db TO demo_db_user",
		"REVOKE TEMPORARY ON DATABASE demo_db FROM PUBLIC",
		"GRANT ALL PRIVILEGES ON DATABASE demo_db TO demo_db_user",
	}
	for _, w := range want {
		if !strings.Contains(joined, w) {
			t.Fatalf("create SQL missing %q\n%s", w, joined)
		}
	}
	if !strings.Contains(joined, "CREATE ROLE demo_db_user LOGIN PASSWORD") {
		t.Fatalf("missing CREATE ROLE\n%s", joined)
	}
}
