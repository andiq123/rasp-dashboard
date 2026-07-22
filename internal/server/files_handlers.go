package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	filesMaxEntries   = 2500
	filesPreviewMax   = 256 << 10 // 256 KiB
	filesCopyMaxBytes = 512 << 20 // 512 MiB hard stop for single-file copy
)

type fileEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Type       string `json:"type"` // dir|file|symlink|other
	Kind       string `json:"kind"`
	Ext        string `json:"ext,omitempty"`
	Size       int64  `json:"size"`
	SizeHuman  string `json:"size_human"`
	Mode       string `json:"mode"`
	Modified   string `json:"modified"`
	ModifiedMs int64  `json:"modified_ms"`
	Readable   bool   `json:"readable"`
	Textual    bool   `json:"textual,omitempty"`
	LinkTarget string `json:"link_target,omitempty"`
}

type filesSummary struct {
	Dirs       int    `json:"dirs"`
	Files      int    `json:"files"`
	Symlinks   int    `json:"symlinks"`
	Others     int    `json:"others"`
	TotalBytes int64  `json:"total_bytes"`
	TotalHuman string `json:"total_human"`
	Hidden     int    `json:"hidden"`
	Truncated  bool   `json:"truncated"`
	EntryCount int    `json:"entry_count"`
}

type filesListing struct {
	Path     string       `json:"path"`
	Parent   string       `json:"parent"`
	Exists   bool         `json:"exists"`
	Readable bool         `json:"readable"`
	Entries  []fileEntry  `json:"entries"`
	Summary  filesSummary `json:"summary"`
	Error    string       `json:"error,omitempty"`
}

type filesPreview struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	SizeHuman string `json:"size_human"`
	Text      string `json:"text,omitempty"`
	Binary    bool   `json:"binary,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	Error     string `json:"error,omitempty"`
}

type filesOpReq struct {
	Op   string `json:"op"` // delete|rename|copy|move
	Path string `json:"path"`
	To   string `json:"to,omitempty"`
	Name string `json:"name,omitempty"` // rename basename
}

func (s *Server) handleAPIFiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		raw := r.URL.Query().Get("path")
		if raw == "" {
			raw = "/home/andiq"
		}
		listing, err := listFiles(raw)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		jsonReply(w, listing)
	case http.MethodPost:
		s.handleFilesOp(w, r)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleAPIFilesPreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	raw := r.URL.Query().Get("path")
	prev, err := previewFile(raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	jsonReply(w, prev)
}

func (s *Server) handleFilesOp(w http.ResponseWriter, r *http.Request) {
	var req filesOpReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	req.Op = strings.ToLower(strings.TrimSpace(req.Op))
	src, err := cleanAbsPath(req.Path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := guardProtected(src); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	var dst string
	switch req.Op {
	case "delete":
		if err := removePath(src); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]any{"ok": true, "op": "delete", "path": src})
	case "rename":
		name := strings.TrimSpace(req.Name)
		if name == "" || strings.Contains(name, "/") || name == "." || name == ".." {
			http.Error(w, "invalid name", http.StatusBadRequest)
			return
		}
		dst = filepath.Join(filepath.Dir(src), name)
		if err := guardProtected(dst); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		if _, err := os.Lstat(dst); err == nil {
			http.Error(w, "target already exists", http.StatusConflict)
			return
		}
		if err := os.Rename(src, dst); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]any{"ok": true, "op": "rename", "path": dst})
	case "copy", "move":
		dstRaw := req.To
		if dstRaw == "" {
			http.Error(w, "missing to", http.StatusBadRequest)
			return
		}
		dst, err = cleanAbsPath(dstRaw)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := guardProtected(dst); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		if dst == src || strings.HasPrefix(dst+string(os.PathSeparator), src+string(os.PathSeparator)) {
			http.Error(w, "invalid destination", http.StatusBadRequest)
			return
		}
		// If destination is an existing directory, place basename inside it.
		if fi, err := os.Lstat(dst); err == nil && fi.IsDir() {
			dst = uniqueChildPath(dst, filepath.Base(src))
		} else if _, err := os.Lstat(dst); err == nil {
			http.Error(w, "target already exists", http.StatusConflict)
			return
		} else if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if req.Op == "move" {
			if err := os.Rename(src, dst); err != nil {
				// cross-device fallback: copy then delete
				if err2 := copyPath(src, dst); err2 != nil {
					http.Error(w, err2.Error(), http.StatusBadRequest)
					return
				}
				_ = removePath(src)
			}
			jsonReply(w, map[string]any{"ok": true, "op": "move", "path": dst})
			return
		}
		if err := copyPath(src, dst); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonReply(w, map[string]any{"ok": true, "op": "copy", "path": dst})
	default:
		http.Error(w, "unknown op", http.StatusBadRequest)
	}
}

func listFiles(raw string) (filesListing, error) {
	out := filesListing{Entries: []fileEntry{}}
	clean, err := cleanAbsPath(raw)
	if err != nil {
		return out, err
	}
	out.Path = clean
	if clean == "/" {
		out.Parent = ""
	} else {
		out.Parent = filepath.Dir(clean)
	}

	fi, err := os.Lstat(clean)
	if err != nil {
		if os.IsNotExist(err) {
			out.Exists = false
			out.Error = "path does not exist"
			return out, nil
		}
		out.Exists = true
		out.Readable = false
		out.Error = err.Error()
		return out, nil
	}
	out.Exists = true
	if !fi.IsDir() {
		return listFiles(filepath.Dir(clean))
	}

	f, err := os.Open(clean)
	if err != nil {
		out.Readable = false
		out.Error = err.Error()
		return out, nil
	}
	defer f.Close()
	out.Readable = true

	names, err := f.Readdirnames(filesMaxEntries + 1)
	if err != nil && len(names) == 0 {
		out.Error = err.Error()
		return out, nil
	}
	truncated := len(names) > filesMaxEntries
	if truncated {
		names = names[:filesMaxEntries]
	}

	entries := make([]fileEntry, 0, len(names))
	var sum filesSummary
	sum.Truncated = truncated

	for _, name := range names {
		if name == "." || name == ".." {
			continue
		}
		full := filepath.Join(clean, name)
		ent := fileEntry{
			Name:     name,
			Path:     full,
			Readable: true,
		}
		if strings.HasPrefix(name, ".") {
			sum.Hidden++
		}

		st, lerr := os.Lstat(full)
		if lerr != nil {
			ent.Type = "other"
			ent.Kind = "Unknown"
			ent.Readable = false
			ent.SizeHuman = "—"
			ent.Mode = "?"
			sum.Others++
			entries = append(entries, ent)
			continue
		}

		ent.Mode = st.Mode().String()
		mod := st.ModTime().UTC()
		ent.Modified = mod.Format(time.RFC3339)
		ent.ModifiedMs = mod.UnixMilli()
		mode := st.Mode()

		switch {
		case mode&os.ModeSymlink != 0:
			ent.Type = "symlink"
			ent.Kind = "Alias"
			ent.SizeHuman = "—"
			ent.Ext = fileExt(name)
			sum.Symlinks++
			if tgt, rerr := os.Readlink(full); rerr == nil {
				ent.LinkTarget = tgt
			}
		case mode.IsDir():
			ent.Type = "dir"
			ent.Kind = "Folder"
			ent.SizeHuman = "—"
			sum.Dirs++
		case mode.IsRegular():
			ent.Type = "file"
			ent.Size = st.Size()
			ent.SizeHuman = humanBytes(st.Size())
			ent.Ext = fileExt(name)
			ent.Kind = fileKind(ent.Ext, name)
			ent.Textual = isTextExt(ent.Ext, name)
			sum.Files++
			sum.TotalBytes += st.Size()
		default:
			ent.Type = "other"
			ent.Kind = otherKind(mode)
			ent.Size = st.Size()
			if ent.Size > 0 {
				ent.SizeHuman = humanBytes(ent.Size)
			} else {
				ent.SizeHuman = "—"
			}
			sum.Others++
		}

		entries = append(entries, ent)
	}

	sort.SliceStable(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		ad, bd := a.Type == "dir", b.Type == "dir"
		if ad != bd {
			return ad
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})

	sum.TotalHuman = humanBytes(sum.TotalBytes)
	sum.EntryCount = len(entries)
	out.Entries = entries
	out.Summary = sum
	return out, nil
}

func previewFile(raw string) (filesPreview, error) {
	out := filesPreview{}
	clean, err := cleanAbsPath(raw)
	if err != nil {
		return out, err
	}
	out.Path = clean
	out.Name = filepath.Base(clean)

	st, err := os.Lstat(clean)
	if err != nil {
		return out, err
	}
	if st.Mode()&os.ModeSymlink != 0 || !st.Mode().IsRegular() {
		out.Error = "preview is only available for regular files"
		return out, nil
	}
	out.Size = st.Size()
	out.SizeHuman = humanBytes(st.Size())

	f, err := os.Open(clean)
	if err != nil {
		return out, err
	}
	defer f.Close()

	buf := make([]byte, filesPreviewMax+1)
	n, err := io.ReadFull(f, buf)
	if err == io.EOF || err == io.ErrUnexpectedEOF {
		err = nil
	}
	if err != nil {
		return out, err
	}
	truncated := n > filesPreviewMax
	if truncated {
		n = filesPreviewMax
	}
	data := buf[:n]
	if !isLikelyText(data) {
		out.Binary = true
		out.Error = "binary file — preview unavailable"
		return out, nil
	}
	if !utf8.Valid(data) {
		// replace invalid sequences for display
		out.Text = strings.ToValidUTF8(string(data), "\uFFFD")
	} else {
		out.Text = string(data)
	}
	out.Truncated = truncated
	return out, nil
}

func cleanAbsPath(raw string) (string, error) {
	raw = strings.ReplaceAll(strings.TrimSpace(raw), "\x00", "")
	if raw == "" {
		return "", fmt.Errorf("path required")
	}
	if !strings.HasPrefix(raw, "/") {
		return "", fmt.Errorf("path must be absolute")
	}
	clean := filepath.Clean(raw)
	if !filepath.IsAbs(clean) {
		return "", fmt.Errorf("invalid path")
	}
	return clean, nil
}

func guardProtected(path string) error {
	switch path {
	case "/", "/boot", "/boot/firmware", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64",
		"/dev", "/proc", "/sys", "/run", "/home", "/root":
		return fmt.Errorf("refusing to modify protected path")
	}
	return nil
}

func removePath(path string) error {
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if st.IsDir() {
		return os.RemoveAll(path)
	}
	return os.Remove(path)
}

func uniqueChildPath(dir, base string) string {
	cand := filepath.Join(dir, base)
	if _, err := os.Lstat(cand); err != nil {
		return cand
	}
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for i := 1; i < 1000; i++ {
		cand = filepath.Join(dir, fmt.Sprintf("%s copy %d%s", stem, i, ext))
		if _, err := os.Lstat(cand); err != nil {
			return cand
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s copy %d%s", stem, time.Now().Unix(), ext))
}

func copyPath(src, dst string) error {
	st, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if st.Mode()&os.ModeSymlink != 0 {
		tgt, err := os.Readlink(src)
		if err != nil {
			return err
		}
		return os.Symlink(tgt, dst)
	}
	if st.IsDir() {
		return copyDir(src, dst)
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("unsupported file type")
	}
	if st.Size() > filesCopyMaxBytes {
		return fmt.Errorf("file too large to copy (max %s)", humanBytes(filesCopyMaxBytes))
	}
	return copyFile(src, dst, st.Mode())
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode.Perm())
	if err != nil {
		return err
	}
	defer func() {
		_ = out.Close()
	}()
	if _, err := io.Copy(out, in); err != nil {
		_ = os.Remove(dst)
		return err
	}
	return out.Close()
}

func copyDir(src, dst string) error {
	if err := os.Mkdir(dst, 0o755); err != nil {
		return err
	}
	ents, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range ents {
		from := filepath.Join(src, e.Name())
		to := filepath.Join(dst, e.Name())
		if err := copyPath(from, to); err != nil {
			return err
		}
	}
	return nil
}

func fileExt(name string) string {
	if name == "" {
		return ""
	}
	if strings.HasPrefix(name, ".") && strings.Count(name, ".") == 1 {
		return ""
	}
	ext := filepath.Ext(name)
	if ext == "" || ext == "." {
		return ""
	}
	return strings.ToLower(strings.TrimPrefix(ext, "."))
}

func fileKind(ext, name string) string {
	switch ext {
	case "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "heic", "bmp":
		return "Image"
	case "mp4", "mov", "mkv", "webm", "avi":
		return "Movie"
	case "mp3", "wav", "flac", "aac", "m4a", "ogg":
		return "Audio"
	case "pdf":
		return "PDF Document"
	case "txt", "md", "rst", "log", "csv":
		return "Text"
	case "json", "yml", "yaml", "toml", "xml", "ini", "conf", "cfg", "env":
		return "Config"
	case "go", "js", "ts", "tsx", "jsx", "py", "rs", "c", "h", "cpp", "java", "sh", "bash", "zsh":
		return "Source Code"
	case "html", "css", "scss":
		return "Web"
	case "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar":
		return "Archive"
	case "deb", "rpm":
		return "Package"
	case "so", "a", "dylib":
		return "Library"
	case "woff", "woff2", "ttf", "otf":
		return "Font"
	case "db", "sqlite", "sqlite3":
		return "Database"
	case "":
		switch strings.ToLower(name) {
		case "dockerfile", "makefile", "readme", "license", "changelog":
			return "Document"
		default:
			return "Document"
		}
	default:
		return strings.ToUpper(ext) + " File"
	}
}

func isTextExt(ext, name string) bool {
	switch ext {
	case "txt", "md", "rst", "log", "csv", "tsv", "json", "yml", "yaml", "toml", "xml",
		"ini", "conf", "cfg", "env", "go", "js", "ts", "tsx", "jsx", "py", "rs", "c", "h",
		"cpp", "hpp", "java", "sh", "bash", "zsh", "html", "css", "scss", "sass", "sql",
		"mod", "sum", "service", "timer", "desktop", "gitignore", "dockerignore", "editorconfig":
		return true
	case "":
		switch strings.ToLower(name) {
		case "dockerfile", "makefile", "readme", "license", "changelog", "gemfile", "procfile":
			return true
		}
	}
	return false
}

func isLikelyText(b []byte) bool {
	if len(b) == 0 {
		return true
	}
	if strings.Contains(string(b[:min(len(b), 8)]), "\x00") {
		return false
	}
	for i := 0; i < len(b); i++ {
		if b[i] == 0 {
			return false
		}
	}
	// allow high ratio of printable / whitespace
	bad := 0
	for i := 0; i < len(b); i++ {
		c := b[i]
		if c == 9 || c == 10 || c == 13 {
			continue
		}
		if c < 32 {
			bad++
		}
	}
	return bad*20 <= len(b) // <=5% control bytes
}

func otherKind(mode os.FileMode) string {
	switch {
	case mode&os.ModeSocket != 0:
		return "Socket"
	case mode&os.ModeNamedPipe != 0:
		return "Pipe"
	case mode&os.ModeDevice != 0:
		if mode&os.ModeCharDevice != 0 {
			return "Char Device"
		}
		return "Block Device"
	default:
		return "Special"
	}
}

func humanBytes(n int64) string {
	if n < 0 {
		return "—"
	}
	if n < 1024 {
		return strconv.FormatInt(n, 10) + " B"
	}
	units := []string{"KB", "MB", "GB", "TB", "PB"}
	v := float64(n) / 1024 // already KB
	i := 0
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	switch {
	case v >= 100:
		return strconv.FormatFloat(v, 'f', 0, 64) + " " + units[i]
	case v >= 10:
		return strconv.FormatFloat(v, 'f', 1, 64) + " " + units[i]
	default:
		return strconv.FormatFloat(v, 'f', 2, 64) + " " + units[i]
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
