//go:build ignore

// Packjs concatenates numbered JS modules into assets/js/app.js and minifies CSS.
// Run: go generate ./internal/server/web
package main

import (
	"bytes"
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
	webRoot := root
	jsDir := filepath.Join(root, "assets", "js")
	if _, err := os.Stat(jsDir); err != nil {
		webRoot = filepath.Join(root, "internal", "server", "web")
		jsDir = filepath.Join(webRoot, "assets", "js")
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
	b.WriteString("(function(){")
	for _, name := range mods {
		path := filepath.Join(jsDir, name)
		body, err := os.ReadFile(path)
		if err != nil {
			fatal(err)
		}
		b.WriteString(minifyJS(string(body)))
		b.WriteByte('\n')
	}
	b.WriteString("})();")

	out := filepath.Join(jsDir, "app.js")
	if err := writeAtomic(out, []byte(b.String())); err != nil {
		fatal(err)
	}
	fmt.Printf("wrote %s from %v (%d bytes)\n", out, mods, len(b.String()))

	// CSS: strip comments only. Full whitespace minify breaks selectors
	// (".a .b" must not become ".a.b").
	cssSrc := filepath.Join(webRoot, "assets", "dashboard.css")
	cssBody, err := os.ReadFile(cssSrc)
	if err != nil {
		fatal(err)
	}
	outCSS := stripCSSComments(string(cssBody))
	cssOut := filepath.Join(webRoot, "assets", "dashboard.min.css")
	if err := writeAtomic(cssOut, []byte(outCSS)); err != nil {
		fatal(err)
	}
	fmt.Printf("wrote %s (%d → %d bytes)\n", cssOut, len(cssBody), len(outCSS))
}

func writeAtomic(path string, body []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// minifyJS is a light pass: drop full-line // comments and collapse blank/indent noise.
// It does not rewrite string contents.
func minifyJS(src string) string {
	var out strings.Builder
	out.Grow(len(src))
	lines := strings.Split(src, "\n")
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "//") {
			continue
		}
		out.WriteString(strings.TrimRight(line, " \t"))
		out.WriteByte('\n')
	}
	return out.String()
}

// stripCSSComments removes /* … */ outside of strings. Preserves all whitespace.
func stripCSSComments(src string) string {
	var buf bytes.Buffer
	buf.Grow(len(src))
	inStr := byte(0)
	inComment := false
	for i := 0; i < len(src); i++ {
		c := src[i]
		if inComment {
			if c == '*' && i+1 < len(src) && src[i+1] == '/' {
				inComment = false
				i++
			}
			continue
		}
		if inStr != 0 {
			buf.WriteByte(c)
			if c == '\\' && i+1 < len(src) {
				i++
				buf.WriteByte(src[i])
				continue
			}
			if c == inStr {
				inStr = 0
			}
			continue
		}
		if c == '"' || c == '\'' {
			inStr = c
			buf.WriteByte(c)
			continue
		}
		if c == '/' && i+1 < len(src) && src[i+1] == '*' {
			inComment = true
			i++
			continue
		}
		buf.WriteByte(c)
	}
	return buf.String()
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "packjs: %v\n", err)
	os.Exit(1)
}
