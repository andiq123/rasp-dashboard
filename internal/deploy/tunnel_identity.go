package deploy

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var cloudflareTunnelIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type cloudflareTunnelToken struct {
	TunnelID string `json:"t"`
}

func parseManagedTunnelToken(token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" || strings.ContainsAny(token, "\r\n\x00") {
		return "", fmt.Errorf("valid Cloudflare tunnel token required")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(token, "="))
	if err != nil {
		return "", fmt.Errorf("valid Cloudflare tunnel token required")
	}
	var payload cloudflareTunnelToken
	if err := json.Unmarshal(decoded, &payload); err != nil || !cloudflareTunnelIDPattern.MatchString(payload.TunnelID) {
		return "", fmt.Errorf("valid Cloudflare tunnel token required")
	}
	return payload.TunnelID, nil
}

func (m *Manager) managedTunnelID(group, slug string) string {
	b, err := os.ReadFile(m.managedTunnelTokenPath(group, slug))
	if err != nil {
		return ""
	}
	id, _ := parseManagedTunnelToken(string(b))
	return id
}

func (m *Manager) managedTunnelOwner(tunnelID, targetPath string) string {
	paths, _ := filepath.Glob(filepath.Join(m.DeployDir, "groups", "*", "*", "tunnel", "managed.token"))
	for _, path := range paths {
		if path == targetPath {
			continue
		}
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		id, err := parseManagedTunnelToken(string(b))
		if err != nil || id != tunnelID {
			continue
		}
		serviceDir := filepath.Dir(filepath.Dir(path))
		rel, err := filepath.Rel(filepath.Join(m.DeployDir, "groups"), serviceDir)
		if err == nil {
			return filepath.ToSlash(rel)
		}
		return "another service"
	}
	return ""
}
