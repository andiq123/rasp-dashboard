package deploy

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Railway-style templates: ${{service.KEY}} and ${{secret(64)}}
// Docs: https://docs.railway.com/variables/reference
var (
	envRefRe    = regexp.MustCompile(`\$\{\{\s*([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)\s*\}\}`)
	envSecretRe = regexp.MustCompile(`\$\{\{\s*secret\((\d+)\)\s*\}\}`)
)

func refExpr(svcSlug, key string) string {
	return "${{" + strings.TrimSpace(svcSlug) + "." + key + "}}"
}

// materializeSecrets replaces ${{secret(N)}} with a random hex string (once).
// Returns the new body and whether any secret was generated.
func materializeSecrets(body string) (string, bool) {
	if !envSecretRe.MatchString(body) {
		return body, false
	}
	changed := false
	out := envSecretRe.ReplaceAllStringFunc(body, func(m string) string {
		sub := envSecretRe.FindStringSubmatch(m)
		if len(sub) < 2 {
			return m
		}
		n, _ := strconv.Atoi(sub[1])
		if n <= 0 {
			n = 32
		}
		if n > 256 {
			n = 256
		}
		changed = true
		return randomHex(n)
	})
	return out, changed
}

// resolveEnvRefs expands ${{service.KEY}} against other services in the same group.
// Unresolved refs are left intact. Call after materializeSecrets for runtime.env.
func (m *Manager) resolveEnvRefs(group, body string) string {
	group = strings.TrimSpace(group)
	if body == "" || !strings.Contains(body, "${{") {
		return body
	}
	mp := parseEnvMap(body)
	cache := map[string]map[string]string{}

	lookup := func(svcSlug, key string) string {
		svcSlug = strings.TrimSpace(svcSlug)
		key = strings.TrimSpace(key)
		if svcSlug == "" || key == "" {
			return ""
		}
		svcMap, ok := cache[svcSlug]
		if !ok {
			b, err := os.ReadFile(filepath.Join(m.serviceDir(group, svcSlug), "env"))
			if err != nil {
				cache[svcSlug] = map[string]string{}
				return ""
			}
			svcMap = parseEnvMap(string(b))
			cache[svcSlug] = svcMap
		}
		return envGet(svcMap, key)
	}

	out := make(map[string]string, len(mp))
	for k, v := range mp {
		out[k] = resolveServiceRefs(v, lookup)
	}
	return envMapToDotenv(out)
}

func resolveServiceRefs(v string, lookup func(svc, key string) string) string {
	if !strings.Contains(v, "${{") {
		return v
	}
	return envRefRe.ReplaceAllStringFunc(v, func(m string) string {
		sub := envRefRe.FindStringSubmatch(m)
		if len(sub) < 3 {
			return m
		}
		got := lookup(sub[1], sub[2])
		if got == "" {
			return m
		}
		return got
	})
}

func randomHex(n int) string {
	bytes := (n + 1) / 2
	if bytes < 1 {
		bytes = 1
	}
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("fw%0*d", n, n)
	}
	s := hex.EncodeToString(buf)
	if len(s) > n {
		return s[:n]
	}
	return s
}

func envMapToDotenv(mp map[string]string) string {
	if len(mp) == 0 {
		return ""
	}
	keys := make([]string, 0, len(mp))
	for k := range mp {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(mp[k])
		b.WriteByte('\n')
	}
	return b.String()
}
