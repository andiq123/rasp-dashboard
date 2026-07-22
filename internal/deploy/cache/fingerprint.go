package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
)

// Fingerprint hashes the dependency lock inputs for a kind under srcDir.
// Changing the lockfile yields a new key → layer miss / refresh.
func Fingerprint(kind Kind, srcDir string) (string, error) {
	files, err := lockFiles(kind, srcDir)
	if err != nil {
		return "", err
	}
	if len(files) == 0 {
		return "", fmtEmpty(kind)
	}
	h := sha256.New()
	for _, rel := range files {
		_, _ = io.WriteString(h, rel)
		_, _ = io.WriteString(h, "\n")
		b, err := os.ReadFile(filepath.Join(srcDir, rel))
		if err != nil {
			return "", err
		}
		_, _ = h.Write(b)
		_, _ = io.WriteString(h, "\n")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func fmtEmpty(kind Kind) error {
	return &FingerprintError{Kind: kind, Msg: "no lockfile found"}
}

type FingerprintError struct {
	Kind Kind
	Msg  string
}

func (e *FingerprintError) Error() string {
	return string(e.Kind) + ": " + e.Msg
}

func lockFiles(kind Kind, srcDir string) ([]string, error) {
	switch kind {
	case KindGoModules:
		var out []string
		for _, name := range []string{"go.sum", "go.mod"} {
			if fileExists(filepath.Join(srcDir, name)) {
				out = append(out, name)
			}
		}
		return out, nil
	case KindNPMCache, KindNPMModules:
		for _, name := range []string{"pnpm-lock.yaml", "yarn.lock", "package-lock.json", "npm-shrinkwrap.json", "package.json"} {
			if fileExists(filepath.Join(srcDir, name)) {
				// Prefer a single strongest lockfile; include package.json only as last resort.
				if name == "package.json" {
					return []string{name}, nil
				}
				out := []string{name}
				if fileExists(filepath.Join(srcDir, "package.json")) && name != "package.json" {
					out = append(out, "package.json")
				}
				return out, nil
			}
		}
		return nil, nil
	default:
		return nil, &FingerprintError{Kind: kind, Msg: "unknown kind"}
	}
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// DetectNPM returns true when the source tree looks like a Node project.
func DetectNPM(srcDir string) bool {
	return fileExists(filepath.Join(srcDir, "package.json"))
}

// DetectGo returns true when the source tree is a Go module.
func DetectGo(srcDir string) bool {
	return fileExists(filepath.Join(srcDir, "go.mod"))
}

