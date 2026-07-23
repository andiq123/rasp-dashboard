package deploy

import (
	"fmt"
	"strconv"
	"strings"
)

// Canonical production Go build. Static binary, stripped, reproducible paths.
func defaultGoBuildCmd(cmdPath string) string {
	cmdPath = strings.TrimSpace(cmdPath)
	if cmdPath == "" {
		cmdPath = "."
	}
	return fmt.Sprintf(`CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -buildvcs=false -o /out/app %s`, cmdPath)
}

// productionizeBuildCmd upgrades a custom go build to production flags.
// Rejects debug/race builds. Never leaves development-oriented compile flags.
func productionizeBuildCmd(cmd string) (string, error) {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return "", nil
	}
	if err := validateBuildCmd(cmd); err != nil {
		return "", err
	}
	low := strings.ToLower(cmd)
	if strings.Contains(low, "-race") {
		return "", fmt.Errorf("production builds cannot use -race")
	}
	if strings.Contains(cmd, "all=-N") {
		return "", fmt.Errorf("production builds cannot disable optimizations (-gcflags all=-N)")
	}

	// Alpine runtime has no libc — force static builds.
	if strings.Contains(cmd, "CGO_ENABLED=") {
		cmd = replaceEnvAssign(cmd, "CGO_ENABLED", "0")
	} else {
		cmd = "CGO_ENABLED=0 " + cmd
	}

	if !strings.Contains(cmd, "-trimpath") {
		cmd = injectGoBuildFlag(cmd, "-trimpath")
	}
	if !strings.Contains(cmd, "-buildvcs") {
		cmd = injectGoBuildFlag(cmd, "-buildvcs=false")
	}
	if !strings.Contains(cmd, "-ldflags") {
		cmd = injectGoBuildFlag(cmd, `-ldflags="-s -w"`)
	}
	return cmd, nil
}

func injectGoBuildFlag(cmd, flag string) string {
	return strings.Replace(cmd, "go build", "go build "+flag, 1)
}

func replaceEnvAssign(cmd, key, value string) string {
	prefix := key + "="
	parts := strings.Fields(cmd)
	out := make([]string, 0, len(parts))
	replaced := false
	for _, p := range parts {
		if strings.HasPrefix(p, prefix) {
			out = append(out, prefix+value)
			replaced = true
			continue
		}
		out = append(out, p)
	}
	if !replaced {
		return prefix + value + " " + cmd
	}
	return strings.Join(out, " ")
}

// ensureProductionEnv forces production runtime mode for common frameworks.
// Deployed services always run as production — never development/debug.
// Missing JWT_SECRET gets a ${{secret(32)}} placeholder (materialized on save/start).
func ensureProductionEnv(body string) string {
	for _, d := range []struct{ key, value string }{
		{"APP_ENV", "production"},
		{"GO_ENV", "production"},
		{"GIN_MODE", "release"},
		{"NODE_ENV", "production"},
	} {
		body = upsertEnv(body, d.key, d.value)
	}
	mp := parseEnvMap(body)
	for _, s := range bootstrapSecretKeys {
		cur := strings.TrimSpace(mp[s.Key])
		need := cur == "" || isDevEnvValue(cur) || len(cur) < s.Len
		if !need || strings.Contains(cur, "${{") {
			continue
		}
		n := s.Len
		if n < 16 {
			n = 16
		}
		if n > 64 {
			n = 64
		}
		body = upsertEnv(body, s.Key, "${{secret("+strconv.Itoa(n)+")}}")
	}
	return body
}

func isDevEnvValue(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "development", "dev", "debug", "test", "local", "staging":
		return true
	default:
		return false
	}
}

// productionEnvOverrides returns keys forced away from a non-prod value.
func productionEnvOverrides(before, after string) []string {
	b, a := parseEnvMap(before), parseEnvMap(after)
	var out []string
	for _, k := range []string{"APP_ENV", "GO_ENV", "GIN_MODE", "NODE_ENV"} {
		bv := strings.TrimSpace(b[k])
		av := strings.TrimSpace(a[k])
		if bv != "" && bv != av {
			out = append(out, k+"="+bv+"→"+av)
		}
	}
	return out
}
