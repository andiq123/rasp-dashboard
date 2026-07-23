package infra

import "testing"

func TestParseMcDuJSON(t *testing.T) {
	raw := []byte(`{"prefix":"driver-logs-buchet","size":14903280,"objects":5,"status":"success","isVersions":false}`)
	n, ok := parseMcDuJSON(raw)
	if !ok {
		t.Fatal("expected ok")
	}
	if n != 14903280 {
		t.Fatalf("size=%d want 14903280", n)
	}

	empty := []byte(`{"prefix":"empty","size":0,"objects":0,"status":"success"}`)
	n, ok = parseMcDuJSON(empty)
	if !ok || n != 0 {
		t.Fatalf("empty: n=%d ok=%v", n, ok)
	}

	errLine := []byte(`{"status":"error","error":{"message":"nope"}}`)
	n, ok = parseMcDuJSON(errLine)
	if ok || n != 0 {
		t.Fatalf("error line: n=%d ok=%v", n, ok)
	}

	multi := []byte("{\"size\":100,\"status\":\"success\"}\n{\"size\":23,\"status\":\"success\"}\n")
	n, ok = parseMcDuJSON(multi)
	if !ok || n != 123 {
		t.Fatalf("multi: n=%d ok=%v", n, ok)
	}
}
