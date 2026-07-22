package deploy

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Pi MinIO vars — keep it short. No REGION (unused locally).
// FORCE_PATH_STYLE is injected as a literal on link (always true for MinIO).
var linkedBucketKeys = []string{
	"BUCKET",
	"ENDPOINT",
	"ACCESS_KEY_ID",
	"SECRET_ACCESS_KEY",
	"FORCE_PATH_STYLE",
	// Legacy / Railway extras — stripped on unlink.
	"REGION",
	"BUCKET_URL",
	"BUCKET_NAME",
	"BUCKET_ENDPOINT",
	"BUCKET_ACCESS_KEY_ID",
	"BUCKET_SECRET_ACCESS_KEY",
	"BUCKET_REGION",
	"BUCKET_FORCE_PATH_STYLE",
	"AWS_ENDPOINT_URL",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_REGION",
	"AWS_S3_FORCE_PATH_STYLE",
}

func removeLinkedBucketEnv(body string) string {
	for _, k := range linkedBucketKeys {
		body = removeEnvKey(body, k)
	}
	return body
}

// physicalBucketName is the MinIO bucket id for a service.
// Pattern: <group>-<slug>, but never group-group when the label matches the group.
func physicalBucketName(group, slug string) string {
	g := strings.ReplaceAll(strings.TrimSpace(group), "_", "-")
	s := strings.ReplaceAll(strings.TrimSpace(slug), "_", "-")
	g = strings.Trim(g, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return ""
	}
	var phys string
	switch {
	case g == "", s == g, strings.HasPrefix(s, g+"-"):
		phys = s
	default:
		phys = g + "-" + s
	}
	if len(phys) > 60 {
		phys = phys[:60]
	}
	return phys
}

func buildBucketURL(endpoint, accessKey, secretKey, bucket string) string {
	endpoint = strings.TrimSpace(endpoint)
	accessKey = strings.TrimSpace(accessKey)
	secretKey = strings.TrimSpace(secretKey)
	bucket = strings.TrimSpace(bucket)
	if endpoint == "" || accessKey == "" || secretKey == "" || bucket == "" {
		return ""
	}
	u, err := url.Parse(endpoint)
	if err != nil || u == nil || u.Host == "" {
		return ""
	}
	if u.Scheme == "" {
		u.Scheme = "http"
	}
	u.User = url.UserPassword(accessKey, secretKey)
	u.Path = "/" + strings.Trim(bucket, "/")
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

func parseBucketURL(raw string) (endpoint, accessKey, secretKey, bucket string) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil || u.Host == "" {
		return "", "", "", ""
	}
	if u.User != nil {
		accessKey = u.User.Username()
		secretKey, _ = u.User.Password()
	}
	bucket = strings.Trim(u.Path, "/")
	if i := strings.IndexByte(bucket, '/'); i >= 0 {
		bucket = bucket[:i]
	}
	endpoint = (&url.URL{Scheme: u.Scheme, Host: u.Host}).String()
	if endpoint == "" || accessKey == "" || secretKey == "" || bucket == "" {
		return "", "", "", ""
	}
	return endpoint, accessKey, secretKey, bucket
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func bucketURLFromEnvMap(mp map[string]string) string {
	if u := envGet(mp, "BUCKET_URL"); u != "" {
		return u
	}
	return buildBucketURL(
		firstNonEmpty(envGet(mp, "ENDPOINT"), envGet(mp, "BUCKET_ENDPOINT"), envGet(mp, "AWS_ENDPOINT_URL")),
		firstNonEmpty(envGet(mp, "ACCESS_KEY_ID"), envGet(mp, "BUCKET_ACCESS_KEY_ID"), envGet(mp, "AWS_ACCESS_KEY_ID")),
		firstNonEmpty(envGet(mp, "SECRET_ACCESS_KEY"), envGet(mp, "BUCKET_SECRET_ACCESS_KEY"), envGet(mp, "AWS_SECRET_ACCESS_KEY")),
		firstNonEmpty(envGet(mp, "BUCKET"), envGet(mp, "BUCKET_NAME")),
	)
}

func bucketHasCreds(mp map[string]string) bool {
	return firstNonEmpty(envGet(mp, "BUCKET"), envGet(mp, "BUCKET_NAME")) != "" &&
		bucketURLFromEnvMap(mp) != ""
}

// bucketServiceEnv stores the four Pi credentials on the bucket service.
func bucketServiceEnv(bucket, endpoint, accessKey, secretKey string) string {
	body := ""
	body = upsertEnv(body, "BUCKET", strings.TrimSpace(bucket))
	body = upsertEnv(body, "ENDPOINT", strings.TrimSpace(endpoint))
	body = upsertEnv(body, "ACCESS_KEY_ID", strings.TrimSpace(accessKey))
	body = upsertEnv(body, "SECRET_ACCESS_KEY", strings.TrimSpace(secretKey))
	return body
}

func injectBucketCreds(body, bucket, endpoint, accessKey, secretKey, _ string) string {
	body = removeLinkedBucketEnv(body)
	return mergeEnvFiles(body, bucketServiceEnv(bucket, endpoint, accessKey, secretKey))
}

// injectLinkedBucket writes refs for the four keys, plus FORCE_PATH_STYLE=true
// (literal — MinIO needs path-style; no REGION).
func (m *Manager) injectLinkedBucket(body, group, bucketSlug string) string {
	bucketSlug = strings.TrimSpace(bucketSlug)
	if group == "" || bucketSlug == "" {
		return body
	}
	b, err := os.ReadFile(filepath.Join(m.serviceDir(group, bucketSlug), "env"))
	if err != nil {
		return body
	}
	mp := parseEnvMap(string(b))
	if !bucketHasCreds(mp) {
		return body
	}
	body = removeLinkedBucketEnv(body)

	type pair struct{ app, prefer, fallback string }
	for _, p := range []pair{
		{"BUCKET", "BUCKET", "BUCKET_NAME"},
		{"ENDPOINT", "ENDPOINT", "BUCKET_ENDPOINT"},
		{"ACCESS_KEY_ID", "ACCESS_KEY_ID", "BUCKET_ACCESS_KEY_ID"},
		{"SECRET_ACCESS_KEY", "SECRET_ACCESS_KEY", "BUCKET_SECRET_ACCESS_KEY"},
	} {
		src := p.prefer
		if envGet(mp, src) == "" {
			src = p.fallback
		}
		if envGet(mp, src) == "" {
			continue
		}
		body = upsertEnv(body, p.app, refExpr(bucketSlug, src))
	}
	// Always on for local MinIO — not a credential, not a ref.
	body = upsertEnv(body, "FORCE_PATH_STYLE", "true")
	return body
}
