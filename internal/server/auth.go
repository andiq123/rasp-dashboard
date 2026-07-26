package server

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"
)

// Optional Basic Auth via FIREWIFI_AUTH=user:pass.
// When unset, the dashboard stays open (trusted LAN). Deploy hooks keep their own auth.
func withOptionalAuth(next http.Handler) http.Handler {
	user, pass, ok := parseAuthEnv()
	if !ok {
		return next
	}
	wantUser := []byte(user)
	wantPass := []byte(pass)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/hooks/") {
			next.ServeHTTP(w, r)
			return
		}
		u, p, has := r.BasicAuth()
		if !has ||
			subtle.ConstantTimeCompare([]byte(u), wantUser) != 1 ||
			subtle.ConstantTimeCompare([]byte(p), wantPass) != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="FireWifi"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func parseAuthEnv() (user, pass string, ok bool) {
	raw := strings.TrimSpace(os.Getenv("FIREWIFI_AUTH"))
	if raw == "" {
		return "", "", false
	}
	user, pass, cut := strings.Cut(raw, ":")
	if !cut || user == "" || pass == "" {
		return "", "", false
	}
	return user, pass, true
}
