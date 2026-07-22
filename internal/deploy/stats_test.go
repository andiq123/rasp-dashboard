package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadCPUUsageUsecParses(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "cpu.stat"), []byte("usage_usec 12345\nuser_usec 1\nsystem_usec 2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	n, ok := readCPUUsageUsec(dir)
	if !ok || n != 12345 {
		t.Fatalf("got %d %v", n, ok)
	}
}

func TestProcRSSFromStatus(t *testing.T) {
	rss := procRSSBytes(os.Getpid())
	if rss <= 0 {
		t.Fatalf("expected rss > 0, got %d", rss)
	}
}
