package web

//go:generate go run packjs.go

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed index.html assets/dashboard.css assets/js/app.js
var content embed.FS

//go:embed assets/js/*.js
var jsSources embed.FS

// Handler serves /assets/* from the embedded filesystem.
func Handler() http.Handler {
	sub, err := fs.Sub(content, "assets")
	if err != nil {
		panic(err)
	}
	return http.StripPrefix("/assets/", http.FileServer(http.FS(sub)))
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

// JSSourcesFS exposes split JS modules (for tooling / inspection).
func JSSourcesFS() embed.FS { return jsSources }
