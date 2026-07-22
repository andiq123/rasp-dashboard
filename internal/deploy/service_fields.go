package deploy

import (
	"fmt"
	"strings"
)

// mergeServicePreserve keeps operator-owned fields when a deploy pipeline
// rebuilds a Service value from scratch (redeploy / createGo).
func mergeServicePreserve(prev, next Service) Service {
	if !next.AutoDeploySet && prev.AutoDeploySet {
		next.AutoDeploy = prev.AutoDeploy
		next.AutoDeploySet = true
	}
	if next.DeploySHA == "" {
		next.DeploySHA = prev.DeploySHA
	}
	if next.PublicURL == "" {
		next.PublicURL = prev.PublicURL
	}
	if next.StaticHost == "" {
		next.StaticHost = prev.StaticHost
	}
	return next
}

func sameCommit(a, b string) bool {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	return strings.HasPrefix(a, b) || strings.HasPrefix(b, a)
}

func shortSHA(sha string) string {
	sha = strings.TrimSpace(sha)
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

func localOriginURL(port int) string {
	if port <= 0 {
		return ""
	}
	return fmt.Sprintf("http://127.0.0.1:%d", port)
}
