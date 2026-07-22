package web

import (
	"strings"
	"testing"
)

// parseRoute mirrors assets/js/08-render.js parseRoute for regression tests.
func parseRoute(path string) map[string]string {
	p := strings.TrimRight(path, "/")
	if p == "" {
		p = "/"
	}
	out := map[string]string{"navView": "overview"}
	switch p {
	case "/", "/overview":
		return out
	case "/activity":
		out["navView"] = "activity"
		return out
	case "/settings":
		out["navView"] = "settings"
		out["settingsTab"] = "github"
		return out
	case "/settings/storage":
		out["navView"] = "settings"
		out["settingsTab"] = "storage"
		return out
	case "/projects":
		out["navView"] = "projects"
		return out
	}
	const prefix = "/projects/"
	if strings.HasPrefix(p, prefix) {
		rest := strings.TrimPrefix(p, prefix)
		if rest == "" {
			out["navView"] = "projects"
			return out
		}
		parts := strings.SplitN(rest, "/", 2)
		out["navView"] = "projects"
		out["activeGroup"] = parts[0]
		if len(parts) == 2 {
			out["settingsSlug"] = parts[1]
		}
		return out
	}
	return out
}

func TestParseRoute(t *testing.T) {
	cases := []struct {
		path string
		want map[string]string
	}{
		{"/", map[string]string{"navView": "overview"}},
		{"/overview/", map[string]string{"navView": "overview"}},
		{"/activity", map[string]string{"navView": "activity"}},
		{"/settings", map[string]string{"navView": "settings", "settingsTab": "github"}},
		{"/settings/storage", map[string]string{"navView": "settings", "settingsTab": "storage"}},
		{"/projects", map[string]string{"navView": "projects"}},
		{"/projects/demo", map[string]string{"navView": "projects", "activeGroup": "demo"}},
		{"/projects/demo/api", map[string]string{"navView": "projects", "activeGroup": "demo", "settingsSlug": "api"}},
		{"/nope", map[string]string{"navView": "overview"}},
	}
	for _, tc := range cases {
		got := parseRoute(tc.path)
		for k, want := range tc.want {
			if got[k] != want {
				t.Fatalf("parseRoute(%q)[%q] = %q, want %q", tc.path, k, got[k], want)
			}
		}
	}
}

// shellRailItemAria mirrors shellRailHTML aria-current emission in 08-render.js.
func shellRailItemAria(active bool) string {
	if active {
		return ` aria-current="page"`
	}
	return ""
}

// maskEnvValue mirrors assets/js/04-folds.js maskEnvValue for hidden env rows.
func maskEnvValue(v string) string {
	if strings.TrimSpace(v) == "" {
		return "—"
	}
	return "••••••••"
}

func TestShellRailItemAria(t *testing.T) {
	if got := shellRailItemAria(true); got != ` aria-current="page"` {
		t.Fatalf("active: got %q", got)
	}
	if got := shellRailItemAria(false); got != "" {
		t.Fatalf("inactive: got %q, want empty", got)
	}
	if strings.Contains(shellRailItemAria(false), "false") {
		t.Fatal("inactive must not emit aria-current=false")
	}
}

func TestMaskEnvValue(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "—"},
		{"  ", "—"},
		{"short", "••••••••"},
		{"a-very-long-secret-value-that-should-not-change-mask-length", "••••••••"},
	}
	for _, tc := range cases {
		if got := maskEnvValue(tc.in); got != tc.want {
			t.Fatalf("maskEnvValue(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
	if n := len([]rune(maskEnvValue("x"))); n != 8 {
		t.Fatalf("mask length = %d, want 8", n)
	}
}
