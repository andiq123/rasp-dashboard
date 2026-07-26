package deploy

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// physicalDatabaseName is the Postgres DB id for a service.
// Uses "__" between group and slug so (a, b-c) and (a-b, c) never collide
// after hyphen→underscore normalization.
func physicalDatabaseName(group, slug string) string {
	g := physicalIdentPart(group)
	s := physicalIdentPart(slug)
	if s == "" {
		return ""
	}
	var base string
	if g == "" {
		base = s
	} else {
		base = g + "__" + s
	}
	// Leave room for "_user" (Postgres identifier max 63).
	return fitPhysicalName(base, 58, "_")
}

// physicalBucketName is the MinIO bucket id for a service.
// Uses "--" between group and slug so join boundaries stay unambiguous.
func physicalBucketName(group, slug string) string {
	g := physicalBucketPart(group)
	s := physicalBucketPart(slug)
	if s == "" {
		return ""
	}
	var base string
	if g == "" {
		base = s
	} else {
		base = g + "--" + s
	}
	return fitPhysicalName(base, 63, "-")
}

func physicalIdentPart(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "-", "_")
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		}
	}
	out := strings.Trim(b.String(), "_")
	if out != "" && out[0] >= '0' && out[0] <= '9' {
		out = "db_" + out
	}
	return out
}

func physicalBucketPart(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "_", "-")
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		}
	}
	return strings.Trim(b.String(), "-")
}

// fitPhysicalName truncates long names with a stable content hash so distinct
// (group, slug) pairs never collapse to the same physical id.
func fitPhysicalName(name string, max int, sep string) string {
	name = strings.TrimSpace(name)
	if name == "" || max < 12 {
		return name
	}
	if len(name) <= max {
		return name
	}
	sum := sha256.Sum256([]byte(name))
	h := hex.EncodeToString(sum[:4]) // 8 hex chars
	keep := max - len(sep) - len(h)
	if keep < 8 {
		keep = 8
	}
	prefix := name[:keep]
	prefix = strings.TrimRight(prefix, sep+"._")
	if prefix == "" {
		prefix = "x"
	}
	return prefix + sep + h
}

func registryPhysicalTaken(reg registry, typ, physical, exceptGroup, exceptSlug string) bool {
	physical = strings.TrimSpace(physical)
	if physical == "" {
		return false
	}
	for _, svc := range reg.Services {
		if svc.Group == exceptGroup && svc.Slug == exceptSlug {
			continue
		}
		switch typ {
		case TypePostgres:
			if svc.Type == TypePostgres && strings.TrimSpace(svc.Database) == physical {
				return true
			}
		case TypeBucket:
			if svc.Type == TypeBucket && strings.TrimSpace(svc.Bucket) == physical {
				return true
			}
		}
	}
	return false
}
