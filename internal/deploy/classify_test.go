package deploy

import "testing"

func TestClassifyCmdLineSlogLevels(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{`time=2026-07-22T06:35:34.988Z level=WARN msg="provider search failed" error="deadline exceeded"`, "warn"},
		{`time=2026-07-22T06:35:34.988Z level=ERROR msg="boom" error="x"`, "err"},
		{`time=2026-07-22T06:35:34.988Z level=INFO msg="ok"`, "info"},
		{`warning: something soft`, "warn"},
		{`error: hard fail`, "err"},
		{`plain output`, "out"},
	}
	for _, tc := range cases {
		if got := classifyCmdLine(tc.in); got != tc.want {
			t.Fatalf("classifyCmdLine(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}
