package deploy

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Linked DB env keys injected into Go apps (and stored on Postgres services).
var linkedDBKeys = []string{
	"DATABASE_URL",
	"DB_HOST",
	"DB_PORT",
	"DB_NAME",
	"DB_USER",
	"DB_PASSWORD",
	"DB_SSLMODE",
}

func removeLinkedDBEnv(body string) string {
	for _, k := range linkedDBKeys {
		body = removeEnvKey(body, k)
	}
	return body
}

func parsePostgresURL(raw string) (host, port, user, pass, name, sslmode string) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil {
		return "", "", "", "", "", ""
	}
	host = u.Hostname()
	port = u.Port()
	if port == "" {
		port = "5432"
	}
	if u.User != nil {
		user = u.User.Username()
		pass, _ = u.User.Password()
	}
	name = strings.TrimPrefix(u.Path, "/")
	if i := strings.IndexByte(name, '/'); i >= 0 {
		name = name[:i]
	}
	sslmode = u.Query().Get("sslmode")
	if sslmode == "" {
		sslmode = "disable"
	}
	return host, port, user, pass, name, sslmode
}

// injectDatabaseURL sets DATABASE_URL plus discrete DB_* vars apps commonly expect.
func injectDatabaseURL(body, dbURL string) string {
	dbURL = strings.TrimSpace(dbURL)
	if dbURL == "" {
		return body
	}
	body = upsertEnv(body, "DATABASE_URL", dbURL)
	host, port, user, pass, name, ssl := parsePostgresURL(dbURL)
	if host != "" {
		body = upsertEnv(body, "DB_HOST", host)
	}
	if port != "" {
		body = upsertEnv(body, "DB_PORT", port)
	}
	if name != "" {
		body = upsertEnv(body, "DB_NAME", name)
	}
	if user != "" {
		body = upsertEnv(body, "DB_USER", user)
	}
	if pass != "" {
		body = upsertEnv(body, "DB_PASSWORD", pass)
	}
	if ssl != "" {
		body = upsertEnv(body, "DB_SSLMODE", ssl)
	}
	return body
}

// postgresServiceEnv builds the env file for a new group database service.
func postgresServiceEnv(dbURL, dbName, dbUser, dbPass string) string {
	body := ""
	body = injectDatabaseURL(body, dbURL)
	// Keep explicit values (avoid URL-encoding surprises for password).
	body = upsertEnv(body, "DB_HOST", "127.0.0.1")
	body = upsertEnv(body, "DB_PORT", "5432")
	body = upsertEnv(body, "DB_NAME", dbName)
	body = upsertEnv(body, "DB_USER", dbUser)
	body = upsertEnv(body, "DB_PASSWORD", dbPass)
	body = upsertEnv(body, "DB_SSLMODE", "disable")
	body = upsertEnv(body, "POSTGRES_DB", dbName)
	body = upsertEnv(body, "POSTGRES_USER", dbUser)
	body = upsertEnv(body, "POSTGRES_PASSWORD", dbPass)
	return body
}

func envGet(mp map[string]string, key string) string {
	return strings.TrimSpace(mp[key])
}

// injectLinkedDatabase copies connection vars from a group Postgres service into a Go app env.
func (m *Manager) injectLinkedDatabase(body, group, dbSlug string) string {
	dbSlug = strings.TrimSpace(dbSlug)
	if group == "" || dbSlug == "" {
		return body
	}
	b, err := os.ReadFile(filepath.Join(m.serviceDir(group, dbSlug), "env"))
	src := ""
	if err == nil {
		src = string(b)
	}
	mp := parseEnvMap(src)
	dbURL := envGet(mp, "DATABASE_URL")
	if dbURL == "" {
		dbURL = m.readServiceDATABASEURL(group, dbSlug)
	}
	if dbURL != "" {
		body = injectDatabaseURL(body, dbURL)
	}
	// Prefer explicit keys stored on the database service (correct password encoding).
	for _, k := range []string{"DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSLMODE"} {
		if v := envGet(mp, k); v != "" {
			body = upsertEnv(body, k, v)
		}
	}
	out := parseEnvMap(body)
	if envGet(out, "DB_NAME") == "" {
		if v := envGet(mp, "POSTGRES_DB"); v != "" {
			body = upsertEnv(body, "DB_NAME", v)
		}
	}
	if envGet(out, "DB_USER") == "" {
		if v := envGet(mp, "POSTGRES_USER"); v != "" {
			body = upsertEnv(body, "DB_USER", v)
		}
	}
	if envGet(out, "DB_PASSWORD") == "" {
		if v := envGet(mp, "POSTGRES_PASSWORD"); v != "" {
			body = upsertEnv(body, "DB_PASSWORD", v)
		}
	}
	out = parseEnvMap(body)
	if envGet(out, "DB_HOST") == "" {
		body = upsertEnv(body, "DB_HOST", "127.0.0.1")
	}
	if envGet(out, "DB_PORT") == "" {
		body = upsertEnv(body, "DB_PORT", "5432")
	}
	if envGet(out, "DB_SSLMODE") == "" {
		body = upsertEnv(body, "DB_SSLMODE", "disable")
	}
	return body
}

// clearEnvKeys removes one or more keys from a dotenv env body.
func clearEnvKeys(body string, keys ...string) string {
	if body == "" || len(keys) == 0 {
		return body
	}
	drop := map[string]bool{}
	for _, k := range keys {
		drop[k] = true
	}
	var b strings.Builder
	for _, line := range strings.Split(normalizeEnv(body), "\n") {
		line = strings.TrimRight(line, "\r")
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			b.WriteString(line)
			b.WriteByte('\n')
			continue
		}
		i := strings.IndexByte(trim, '=')
		if i <= 0 {
			b.WriteString(line)
			b.WriteByte('\n')
			continue
		}
		k := strings.TrimSpace(trim[:i])
		if drop[k] {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return strings.TrimRight(b.String(), "\n")
}
