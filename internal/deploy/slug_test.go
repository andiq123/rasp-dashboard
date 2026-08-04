package deploy

import (
	"strings"
	"testing"
)

func TestNumericLeadingSlugsRemainReachable(t *testing.T) {
	if got := slugify("999scraper"); got != "999scraper" {
		t.Fatalf("slugify=%q", got)
	}
	if !validSlug("999scraper") {
		t.Fatal("numeric-leading group slug must remain valid")
	}
	if validSlug("-broken") || validSlug("broken_") {
		t.Fatal("invalid path characters accepted")
	}
}

func TestSlugifyCapsGeneratedPaths(t *testing.T) {
	got := slugify(strings.Repeat("a", 80))
	if len(got) != 48 || !validSlug(got) {
		t.Fatalf("generated slug=%q len=%d", got, len(got))
	}
}
