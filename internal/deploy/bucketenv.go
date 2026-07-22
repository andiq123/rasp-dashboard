package deploy

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Linked bucket env: one URL, same idea as DATABASE_URL.
// Format: http://ACCESS_KEY:SECRET_KEY@127.0.0.1:9000/bucket-name
var linkedBucketKeys = []string{
	"BUCKET_URL",
	// Legacy multi-key inject — still stripped on unlink/re-link.
	"BUCKET", "BUCKET_NAME", "BUCKET_ENDPOINT",
	"BUCKET_ACCESS_KEY_ID", "BUCKET_SECRET_ACCESS_KEY",
	"BUCKET_REGION", "BUCKET_FORCE_PATH_STYLE",
	"AWS_ENDPOINT_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
	"AWS_REGION", "AWS_S3_FORCE_PATH_STYLE",
}

func removeLinkedBucketEnv(body string) string {
	for _, k := range linkedBucketKeys {
		body = removeEnvKey(body, k)
	}
	return body
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

// bucketURLFromEnvMap returns BUCKET_URL, or builds one from legacy keys.
func bucketURLFromEnvMap(mp map[string]string) string {
	if u := strings.TrimSpace(envGet(mp, "BUCKET_URL")); u != "" {
		return u
	}
	bucket := envGet(mp, "BUCKET")
	if bucket == "" {
		bucket = envGet(mp, "BUCKET_NAME")
	}
	endpoint := envGet(mp, "BUCKET_ENDPOINT")
	if endpoint == "" {
		endpoint = envGet(mp, "AWS_ENDPOINT_URL")
	}
	access := envGet(mp, "BUCKET_ACCESS_KEY_ID")
	if access == "" {
		access = envGet(mp, "AWS_ACCESS_KEY_ID")
	}
	secret := envGet(mp, "BUCKET_SECRET_ACCESS_KEY")
	if secret == "" {
		secret = envGet(mp, "AWS_SECRET_ACCESS_KEY")
	}
	return buildBucketURL(endpoint, access, secret, bucket)
}

func bucketServiceEnv(bucket, endpoint, accessKey, secretKey string) string {
	return injectBucketURL("", buildBucketURL(endpoint, accessKey, secretKey, bucket))
}

func injectBucketURL(body, bucketURL string) string {
	body = removeLinkedBucketEnv(body)
	bucketURL = strings.TrimSpace(bucketURL)
	if bucketURL == "" {
		return body
	}
	return upsertEnv(body, "BUCKET_URL", bucketURL)
}

func injectBucketCreds(body, bucket, endpoint, accessKey, secretKey, _ string) string {
	return injectBucketURL(body, buildBucketURL(endpoint, accessKey, secretKey, bucket))
}

func (m *Manager) injectLinkedBucket(body, group, bucketSlug string) string {
	bucketSlug = strings.TrimSpace(bucketSlug)
	if group == "" || bucketSlug == "" {
		return body
	}
	b, err := os.ReadFile(filepath.Join(m.serviceDir(group, bucketSlug), "env"))
	if err != nil {
		return body
	}
	return injectBucketURL(body, bucketURLFromEnvMap(parseEnvMap(string(b))))
}
