package deploy

import (
	"net/url"
	"strconv"
	"strings"
)

// Linked Redis values injected only into explicitly linked Go services.
var linkedRedisKeys = []string{
	"REDIS_URL",
	"REDIS_HOST",
	"REDIS_PORT",
	"REDIS_USERNAME",
	"REDIS_PASSWORD",
	"REDIS_DB",
	"REDIS_TLS",
}

func removeLinkedRedisEnv(body string) string {
	return clearEnvKeys(body, linkedRedisKeys...)
}

func buildRedisURL(host string, port int, password string) string {
	host = strings.TrimSpace(host)
	password = strings.TrimSpace(password)
	if host == "" || port <= 0 || password == "" {
		return ""
	}
	u := &url.URL{
		Scheme: "redis",
		Host:   host + ":" + strconv.Itoa(port),
		Path:   "/0",
		User:   url.UserPassword("default", password),
	}
	return u.String()
}

func redisServiceEnv(host string, port int, password string) string {
	body := ""
	body = upsertEnv(body, "REDIS_URL", buildRedisURL(host, port, password))
	body = upsertEnv(body, "REDIS_HOST", strings.TrimSpace(host))
	body = upsertEnv(body, "REDIS_PORT", strconv.Itoa(port))
	body = upsertEnv(body, "REDIS_USERNAME", "default")
	body = upsertEnv(body, "REDIS_PASSWORD", strings.TrimSpace(password))
	body = upsertEnv(body, "REDIS_DB", "0")
	body = upsertEnv(body, "REDIS_TLS", "false")
	return body
}

func redisServiceHasCreds(mp map[string]string) bool {
	return envGet(mp, "REDIS_URL") != "" && envGet(mp, "REDIS_PASSWORD") != ""
}

func redisLinkSpec() linkedEnvSpec {
	return linkedEnvSpec{
		Kind:   "redis",
		Remove: linkedRedisKeys,
		Copy: []linkedKeyCopy{
			{"REDIS_URL", "REDIS_URL", ""},
			{"REDIS_HOST", "REDIS_HOST", ""},
			{"REDIS_PORT", "REDIS_PORT", ""},
			{"REDIS_USERNAME", "REDIS_USERNAME", ""},
			{"REDIS_PASSWORD", "REDIS_PASSWORD", ""},
			{"REDIS_DB", "REDIS_DB", ""},
			{"REDIS_TLS", "REDIS_TLS", ""},
		},
	}
}

func (m *Manager) injectLinkedRedis(body, group, redisSlug string) string {
	redisSlug = strings.TrimSpace(redisSlug)
	if group == "" || redisSlug == "" {
		return body
	}
	mp := m.readServiceEnvMap(group, redisSlug)
	if !redisServiceHasCreds(mp) {
		return body
	}
	return m.injectLinkedServiceEnvFrom(body, group, redisSlug, mp, redisLinkSpec())
}

func (m *Manager) readServiceREDISURL(group, slug string) string {
	return envGet(m.readServiceEnvMap(group, slug), "REDIS_URL")
}
