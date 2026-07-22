//go:build ignore

// Packjs concatenates numbered JS modules into assets/js/app.js.
// Run: go generate ./internal/server/web
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

func main() {
	root, err := os.Getwd()
	if err != nil {
		fatal(err)
	}
	// Allow running from repo root: go run ./internal/server/web/packjs.go
	jsDir := filepath.Join(root, "assets", "js")
	if _, err := os.Stat(jsDir); err != nil {
		jsDir = filepath.Join(root, "internal", "server", "web", "assets", "js")
	}
	if _, err := os.Stat(jsDir); err != nil {
		fatal(fmt.Errorf("js modules dir not found (cwd=%s)", root))
	}

	ents, err := os.ReadDir(jsDir)
	if err != nil {
		fatal(err)
	}
	var mods []string
	for _, e := range ents {
		name := e.Name()
		if e.IsDir() || name == "app.js" || !strings.HasSuffix(name, ".js") {
			continue
		}
		if name == "" || !unicode.IsDigit(rune(name[0])) {
			continue
		}
		mods = append(mods, name)
	}
	sort.Strings(mods)
	if len(mods) == 0 {
		fatal(fmt.Errorf("no numbered *.js modules in %s", jsDir))
	}

	var b strings.Builder
	b.WriteString("(function () {\n")
	for _, name := range mods {
		path := filepath.Join(jsDir, name)
		body, err := os.ReadFile(path)
		if err != nil {
			fatal(err)
		}
		b.WriteString("\n  /* === ")
		b.WriteString(name)
		b.WriteString(" === */\n")
		b.Write(body)
		if len(body) == 0 || body[len(body)-1] != '\n' {
			b.WriteByte('\n')
		}
	}
	b.WriteString("})();\n")

	out := filepath.Join(jsDir, "app.js")
	tmp := out + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o644); err != nil {
		fatal(err)
	}
	if err := os.Rename(tmp, out); err != nil {
		fatal(err)
	}
	fmt.Printf("wrote %s from %v\n", out, mods)
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "packjs: %v\n", err)
	os.Exit(1)
}
