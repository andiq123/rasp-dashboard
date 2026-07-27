package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListFilesMarksHiddenDotfiles(t *testing.T) {
	root := t.TempDir()
	t.Setenv("FIREWIFI_FILES_ROOT", root)
	_ = os.WriteFile(filepath.Join(root, "visible.txt"), []byte("ok"), 0o644)
	_ = os.WriteFile(filepath.Join(root, ".secret"), []byte("no"), 0o644)
	_ = os.Mkdir(filepath.Join(root, ".cache"), 0o755)
	_ = os.Mkdir(filepath.Join(root, "docs"), 0o755)

	listing, err := listFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	if listing.Summary.Hidden != 2 {
		t.Fatalf("hidden count=%d want 2", listing.Summary.Hidden)
	}
	byName := map[string]fileEntry{}
	for _, e := range listing.Entries {
		byName[e.Name] = e
	}
	if !byName[".secret"].Hidden || !byName[".cache"].Hidden {
		t.Fatalf("dot entries must be hidden: %+v", byName)
	}
	if byName["visible.txt"].Hidden || byName["docs"].Hidden {
		t.Fatalf("visible entries must not be hidden: %+v", byName)
	}
}
