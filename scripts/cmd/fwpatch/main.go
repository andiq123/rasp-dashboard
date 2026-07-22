// Command fwpatch applies exact text edits or full-file writes.
// Prefer this over Python one-off patch scripts on the FireWifi host.
//
// Examples:
//
//	go run ./scripts/cmd/fwpatch -file path.go -old old.txt -new new.txt
//	go run ./scripts/cmd/fwpatch -file path.css -append block.css
//	go run ./scripts/cmd/fwpatch -file path.js -after "marker" -insert block.js
//	go run ./scripts/cmd/fwpatch -file path.go -write contents.go
package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	file := flag.String("file", "", "target file to edit")
	oldPath := flag.String("old", "", "file containing exact text to find (with -new)")
	newPath := flag.String("new", "", "file containing replacement text (with -old)")
	appendPath := flag.String("append", "", "file whose contents are appended")
	writePath := flag.String("write", "", "replace entire target with this file's contents")
	after := flag.String("after", "", "exact marker string; insert -insert after first match")
	before := flag.String("before", "", "exact marker string; insert -insert before first match")
	insertPath := flag.String("insert", "", "file to insert (with -after or -before)")
	all := flag.Bool("all", false, "replace every occurrence (default: exactly one)")
	dry := flag.Bool("dry", false, "print would-be result to stdout; do not write")
	flag.Parse()

	if *file == "" {
		fatal("missing -file")
	}

	var (
		out  []byte
		mode int
		src  []byte
	)

	if *writePath != "" {
		body, err := os.ReadFile(*writePath)
		if err != nil {
			fatal("%v", err)
		}
		out = body
		if len(out) > 0 && out[len(out)-1] != '\n' {
			out = append(out, '\n')
		}
		mode++
		if b, err := os.ReadFile(*file); err == nil {
			src = b
		}
	} else {
		var err error
		src, err = os.ReadFile(*file)
		if err != nil {
			fatal("%v", err)
		}
		out = src
	}

	if *oldPath != "" || *newPath != "" {
		if *writePath != "" {
			fatal("cannot combine -write with -old/-new")
		}
		if *oldPath == "" || *newPath == "" {
			fatal("-old and -new are both required")
		}
		oldB, err := os.ReadFile(*oldPath)
		if err != nil {
			fatal("%v", err)
		}
		newB, err := os.ReadFile(*newPath)
		if err != nil {
			fatal("%v", err)
		}
		n := bytes.Count(src, oldB)
		if n == 0 {
			fatal("pattern not found in %s", *file)
		}
		if !*all && n != 1 {
			fatal("want exactly 1 match in %s, found %d (pass -all to replace all)", *file, n)
		}
		limit := 1
		if *all {
			limit = -1
		}
		out = bytes.Replace(src, oldB, newB, limit)
		mode++
	}

	if *appendPath != "" {
		if *writePath != "" {
			fatal("cannot combine -write with -append")
		}
		extra, err := os.ReadFile(*appendPath)
		if err != nil {
			fatal("%v", err)
		}
		if len(out) > 0 && out[len(out)-1] != '\n' {
			out = append(out, '\n')
		}
		out = append(out, extra...)
		if len(extra) > 0 && extra[len(extra)-1] != '\n' {
			out = append(out, '\n')
		}
		mode++
	}

	if *after != "" || *before != "" {
		if *writePath != "" {
			fatal("cannot combine -write with -after/-before")
		}
		if *insertPath == "" {
			fatal("-insert required with -after/-before")
		}
		if *after != "" && *before != "" {
			fatal("use only one of -after or -before")
		}
		ins, err := os.ReadFile(*insertPath)
		if err != nil {
			fatal("%v", err)
		}
		marker := *after
		if marker == "" {
			marker = *before
		}
		idx := bytes.Index(out, []byte(marker))
		if idx < 0 {
			fatal("marker not found in %s", *file)
		}
		at := idx
		if *after != "" {
			at = idx + len(marker)
		}
		buf := make([]byte, 0, len(out)+len(ins))
		buf = append(buf, out[:at]...)
		buf = append(buf, ins...)
		buf = append(buf, out[at:]...)
		out = buf
		mode++
	}

	if mode == 0 {
		fatal("nothing to do: pass -write, -old/-new, -append, or -after/-before with -insert")
	}
	if bytes.Equal(src, out) {
		fmt.Fprintf(os.Stderr, "unchanged: %s\n", *file)
		return
	}
	if *dry {
		_, _ = os.Stdout.Write(out)
		return
	}
	if err := atomicWrite(*file, out); err != nil {
		fatal("%v", err)
	}
	fmt.Printf("patched %s (%+d bytes)\n", *file, len(out)-len(src))
}

func atomicWrite(path string, body []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if info, err := os.Stat(path); err == nil {
		_ = os.Chmod(tmpName, info.Mode())
	} else {
		_ = os.Chmod(tmpName, 0o644)
	}
	return os.Rename(tmpName, path)
}

func fatal(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if !strings.HasSuffix(msg, "\n") {
		msg += "\n"
	}
	fmt.Fprint(os.Stderr, "fwpatch: "+msg)
	os.Exit(1)
}
