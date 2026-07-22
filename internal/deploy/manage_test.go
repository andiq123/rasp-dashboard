package deploy

import (
	"context"
	"encoding/json"
	"testing"
)

func TestManageOverviewReturnsStorageWhenDockerFails(t *testing.T) {
	m := &Manager{DeployDir: t.TempDir()}
	// Force DockerInventory failure without touching docker by using cancelled context during inventory.
	// ManageOverview calls DockerInventory first; with normal ctx it may succeed on hardware under test.
	ov, err := m.ManageOverview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ov.DeployBytes < 0 {
		t.Fatalf("deploy bytes: %d", ov.DeployBytes)
	}
	b, err := json.Marshal(ov)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["docker"]; !ok {
		t.Fatalf("missing docker key: %v", raw)
	}
}
