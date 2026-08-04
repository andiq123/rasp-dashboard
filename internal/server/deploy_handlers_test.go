package server

import "testing"

func TestPathSlugAcceptsNumericLeadingRegistryGroups(t *testing.T) {
	for _, slug := range []string{"999scraper", "find-vibe", "0"} {
		if !pathSlug.MatchString(slug) {
			t.Fatalf("expected valid path slug %q", slug)
		}
	}
	for _, slug := range []string{"", "-broken", "has_space", "../escape"} {
		if pathSlug.MatchString(slug) {
			t.Fatalf("expected invalid path slug %q", slug)
		}
	}
}
