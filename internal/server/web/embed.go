package web

//go:generate go run packjs.go

import (
	"compress/gzip"
	"embed"
	"io"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed index.html assets/dashboard.min.css assets/js/app.js
var content embed.FS

// Handler serves /assets/* from the embedded filesystem (gzip when accepted).
func Handler() http.Handler {
	sub, err := fs.Sub(content, "assets")
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
	case strings.HasSuffix(path, ".js"), strings.HasSuffix(path, ".css"), strings.HasSuffix(path, ".html"), strings.HasSuffix(path, ".svg"):
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
	b, err := content.ReadFile("index.html")
	if err != nil {
		panic(err)
	}
	safe := strings.ReplaceAll(stateJSON, "<", `\u003c`)
	safe = strings.ReplaceAll(safe, ">", `\u003e`)
	return strings.Replace(string(b), "__STATE__", safe, 1)
}
