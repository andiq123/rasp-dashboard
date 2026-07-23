package deploy

import (
	"strings"
	"testing"
)

func TestUnquoteEnvAndNormalize(t *testing.T) {
	if got := unquoteEnvValue(`"https://app.example/"`); got != "https://app.example/" {
		t.Fatalf("unquote: %q", got)
	}
	body := "CORS_ALLOWED_ORIGINS=\"https://driver-logs-two.vercel.app/\"\nJWT_SECRET=abc\n"
	m := parseEnvMap(body)
	if m["CORS_ALLOWED_ORIGINS"] != "https://driver-logs-two.vercel.app/" {
		t.Fatalf("parseEnvMap: %#v", m["CORS_ALLOWED_ORIGINS"])
	}
	clean := normalizeEnv(body)
	if strings.Contains(clean, `CORS_ALLOWED_ORIGINS="`) {
		t.Fatalf("normalize kept quotes: %q", clean)
	}
}
