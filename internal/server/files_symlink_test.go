package server

import (
	"os"
	"path/filepath"
	"testing"
)

// A symlinked directory inside the files root must not become a way out of it.
func TestFilesGuardRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	t.Setenv("FIREWIFI_FILES_ROOT", root)

	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("top secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(outside, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Mkdir(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	if prev, err := previewFile(filepath.Join(root, "link", "secret.txt")); err == nil {
		t.Fatalf("preview through symlinked dir must fail, got %+v", prev)
	}
	if _, err := listFiles(filepath.Join(root, "link", "sub")); err == nil {
		t.Fatal("listing through symlinked dir must fail")
	}
	if err := guardFilesMutate(filepath.Join(root, "link", "secret.txt")); err == nil {
		t.Fatal("mutating through symlinked dir must fail")
	}
	if err := guardFilesMutate(filepath.Join(root, "link", "new", "file.txt")); err == nil {
		t.Fatal("creating below a symlinked dir must fail")
	}
	if _, err := os.Stat(filepath.Join(outside, "secret.txt")); err != nil {
		t.Fatalf("outside file must be untouched: %v", err)
	}

	// The link itself is an entry of the root and stays manageable.
	if err := guardFilesMutate(filepath.Join(root, "link")); err != nil {
		t.Fatalf("link entry itself should be allowed: %v", err)
	}
	// Regular paths, existing or not yet created, keep working.
	if prev, err := previewFile(filepath.Join(root, "docs", "a.txt")); err != nil || prev.Text != "hello" {
		t.Fatalf("preview inside root: %+v err=%v", prev, err)
	}
	if err := guardFilesMutate(filepath.Join(root, "new", "deep", "file.txt")); err != nil {
		t.Fatalf("new path inside root should be allowed: %v", err)
	}
	if _, err := listFiles(root); err != nil {
		t.Fatalf("list root: %v", err)
	}
}
