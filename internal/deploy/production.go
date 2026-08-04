package deploy

import (
	"fmt"
	"os"
	"path/filepath"
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

// envStackHints selects which production keys belong on a service.
type envStackHints struct {
	Go   bool // Go service / module
	Gin  bool // gin-gonic present or GIN_MODE already set
	Node bool // package.json present or NODE_ENV already set by the app
}

// frameworkEnvKeys are never stored on postgres/bucket connection services.
var frameworkEnvKeys = []string{
	"APP_ENV", "GO_ENV", "GIN_MODE", "NODE_ENV", "JWT_SECRET",
}

// detectEnvStackHints inspects a source tree (build/repo root) for framework cues.
func detectEnvStackHints(srcDir string) envStackHints {
	h := envStackHints{}
	srcDir = strings.TrimSpace(srcDir)
	if srcDir == "" {
		return h
	}
	if _, err := os.Stat(filepath.Join(srcDir, "go.mod")); err == nil {
		h.Go = true
		h.Gin = moduleRequiresGin(srcDir)
	}
	if _, err := os.Stat(filepath.Join(srcDir, "package.json")); err == nil {
		h.Node = true
	}
	return h
}

func moduleRequiresGin(srcDir string) bool {
	b, err := os.ReadFile(filepath.Join(srcDir, "go.mod"))
	if err != nil {
		return false
	}
	return strings.Contains(string(b), "github.com/gin-gonic/gin")
}

// ensureProductionEnv applies only stack-appropriate production keys.
// Never invents NODE_ENV on pure Go apps or framework keys on databases.
// Hints come from source detection — existing polluted keys are stripped, not preserved.
func ensureProductionEnv(body string, h envStackHints) string {
	if !h.Go && !h.Node && !h.Gin {
		// Connection services (postgres/bucket) or unknown — strip framework leftovers.
		return clearEnvKeys(body, frameworkEnvKeys...)
	}

	if h.Go {
		body = upsertEnv(body, "APP_ENV", "production")
		body = upsertEnv(body, "GO_ENV", "production")
	} else {
		body = clearEnvKeys(body, "APP_ENV", "GO_ENV")
	}

	if h.Gin {
		body = upsertEnv(body, "GIN_MODE", "release")
	} else {
		body = clearEnvKeys(body, "GIN_MODE")
	}

	if h.Node {
		body = upsertEnv(body, "NODE_ENV", "production")
	} else {
		body = clearEnvKeys(body, "NODE_ENV")
	}

	mp := parseEnvMap(body)
	if h.Go {
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
	} else {
		body = clearEnvKeys(body, "JWT_SECRET")
	}
	return body
}

// sanitizeServiceEnv removes framework keys that do not belong on this service type.
func sanitizeServiceEnv(body string, svcType string, hints envStackHints) string {
	switch svcType {
	case TypePostgres, TypeBucket, TypeRedis:
		return clearEnvKeys(body, frameworkEnvKeys...)
	case TypeGo:
		hints.Go = true
		return ensureProductionEnv(body, hints)
	default:
		return body
	}
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
		if bv != "" && av != "" && bv != av {
			out = append(out, k+"="+bv+"→"+av)
		}
	}
	return out
}

// productionEnvPresent lists stack production keys actually set on the env body.
func productionEnvPresent(body string) []string {
	mp := parseEnvMap(body)
	var out []string
	for _, k := range []string{"APP_ENV", "GO_ENV", "GIN_MODE", "NODE_ENV"} {
		if strings.TrimSpace(mp[k]) != "" {
			out = append(out, k)
		}
	}
	return out
}
