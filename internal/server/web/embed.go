package web

//go:generate go run packui.go

import (
	"compress/gzip"
	"embed"
	"io"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var content embed.FS

// Handler serves /assets/* from the Vite build (gzip when accepted).
func Handler() http.Handler {
	sub, err := fs.Sub(content, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.StripPrefix("/assets/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") || !compressibleAsset(r.URL.Path) {
			fileServer.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		fileServer.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, Writer: gz}, r)
	}))
}

func compressibleAsset(path string) bool {
	switch {
	case strings.HasSuffix(path, ".js"), strings.HasSuffix(path, ".css"), strings.HasSuffix(path, ".html"), strings.HasSuffix(path, ".svg"), strings.HasSuffix(path, ".map"):
		return true
	default:
		return false
	}
}

type gzipResponseWriter struct {
	http.ResponseWriter
	Writer io.Writer
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	w.Header().Del("Content-Length")
	return w.Writer.Write(b)
}

// PageHTML returns the dashboard HTML with initial state injected.
func PageHTML(stateJSON string) string {
	b, err := content.ReadFile("dist/index.html")
	if err != nil {
		panic(err)
	}
	safe := strings.ReplaceAll(stateJSON, "<", `\u003c`)
	safe = strings.ReplaceAll(safe, ">", `\u003e`)
	html := string(b)
	if !strings.Contains(html, "__STATE__") {
		// Fallback: inject before </body> if template marker missing.
		inject := `<script type="application/json" id="initial-state">` + safe + `</script>`
		return strings.Replace(html, "</body>", inject+"</body>", 1)
	}
	return strings.Replace(html, "__STATE__", safe, 1)
}
