package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestIsRustProject(t *testing.T) {
	rust, both, empty := t.TempDir(), t.TempDir(), t.TempDir()
	writeFile(t, rust, "Cargo.toml", "[package]\nname = \"api\"\n")
	writeFile(t, both, "Cargo.toml", "[package]\nname = \"api\"\n")
	writeFile(t, both, "go.mod", "module x\n")
	if !isRustProject(rust) {
		t.Fatal("Cargo.toml alone is a Rust project")
	}
	if isRustProject(both) {
		t.Fatal("go.mod wins over Cargo.toml")
	}
	if isRustProject(empty) || isRustProject("") {
		t.Fatal("no Cargo.toml is not a Rust project")
	}
	if serviceRuntime(rust) != RuntimeRust || serviceRuntime(both) != "" {
		t.Fatal("runtime label")
	}
	if deployTimeout(rust) <= deployTimeout(both) {
		t.Fatal("Rust deploys need the longer budget")
	}
}

func TestRustBinaryName(t *testing.T) {
	cases := []struct{ name, toml, want, errHas string }{
		{"package", "[package]\nname = \"ieftin-backend\"\nversion = \"0.1.0\"\n\n[dependencies]\nname = \"1\"\n", "ieftin-backend", ""},
		{"bin wins", "[package]\nname = \"lib\"\n\n[[bin]]\nname = \"server\"\npath = \"src/main.rs\"\n\n[[bin]]\nname = \"tool\"\n", "server", ""},
		{"workspace", "[workspace]\nmembers = [\"api\"]\n", "", "no [package]"},
		{"unsafe", "[package]\nname = \"a; rm -rf /\"\n", "", "unsupported"},
	}
	for _, c := range cases {
		dir := t.TempDir()
		writeFile(t, dir, "Cargo.toml", c.toml)
		got, err := rustBinaryName(dir)
		if c.errHas != "" {
			if err == nil || !strings.Contains(err.Error(), c.errHas) {
				t.Fatalf("%s: want error containing %q, got %q / %v", c.name, c.errHas, got, err)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Fatalf("%s: got %q / %v, want %q", c.name, got, err, c.want)
		}
	}
	if _, err := rustBinaryName(t.TempDir()); err == nil {
		t.Fatal("missing Cargo.toml must fail")
	}
}

func TestSuggestLocalRustRoot(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, filepath.Join(repo, "frontend"), "package.json", "{}")
	if got := suggestLocalRustRoot(repo); got != "" {
		t.Fatalf("no crate: got %q", got)
	}
	writeFile(t, filepath.Join(repo, "backend"), "Cargo.toml", "[package]\nname = \"api\"\n")
	if got := suggestLocalRustRoot(repo); got != "backend" {
		t.Fatalf("got %q, want backend", got)
	}
}

func TestCargoTomlIsAModuleRoot(t *testing.T) {
	if goModDir("Cargo.toml") != "" || goModDir("backend/Cargo.toml") != "backend" {
		t.Fatal("Cargo.toml directory")
	}
}

func TestRustServiceGetsNoGoEnv(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "Cargo.toml", "[package]\nname = \"api\"\n")
	env := sanitizeServiceEnv("PORT=5105\n", TypeGo, detectEnvStackHints(dir))
	for _, key := range []string{"APP_ENV", "GO_ENV", "JWT_SECRET"} {
		if strings.Contains(env, key) {
			t.Fatalf("Rust service env must not get %s: %q", key, env)
		}
	}
	if !strings.Contains(env, "PORT=5105") {
		t.Fatalf("own keys must survive: %q", env)
	}
}
