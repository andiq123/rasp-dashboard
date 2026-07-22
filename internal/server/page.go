package server

import (
	"encoding/json"
	"net/http"

	"firewifi/dashboard/internal/server/web"
)

func writePage(w http.ResponseWriter, st State) {
	stateJSON, err := json.Marshal(st)
	if err != nil {
		http.Error(w, "state encode failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(web.PageHTML(string(stateJSON))))
}
