package deploy

import (
	"errors"
	"testing"
)

func TestDockerAbsent(t *testing.T) {
	cases := []struct {
		out string
		err error
		ok  bool
	}{
		{"", nil, false},
		{"Error response from daemon: No such container: fw-find-vibe-find-vibe-db", errors.New("exit status 1"), true},
		{"", errors.New("Error: No such container: fw-x"), true},
		{"permission denied", errors.New("exit 1"), false},
	}
	for _, c := range cases {
		if got := dockerAbsent(c.out, c.err); got != c.ok {
			t.Fatalf("dockerAbsent(%q, %v)=%v want %v", c.out, c.err, got, c.ok)
		}
	}
}
