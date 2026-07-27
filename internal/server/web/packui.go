//go:build ignore

// Packui builds the Vite React app into dist/ for Go embed.
// Run via: go generate ./internal/server/web
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		fail(err)
	}
	// cwd is internal/server/web when run by go generate
	webUI := filepath.Clean(filepath.Join(cwd, "..", "..", "..", "web-ui"))
	if _, err := os.Stat(filepath.Join(webUI, "package.json")); err != nil {
		fail(fmt.Errorf("web-ui not found at %s: %w", webUI, err))
	}

	if _, err := os.Stat(filepath.Join(webUI, "node_modules")); err != nil {
		run(webUI, "npm", "ci")
	}
	run(webUI, "npm", "run", "build")
	fmt.Println("packed web-ui → internal/server/web/dist")
}

func run(dir string, name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	if err := cmd.Run(); err != nil {
		fail(fmt.Errorf("%s %v: %w", name, args, err))
	}
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "packui: %v\n", err)
	os.Exit(1)
}
