package deploy

import "testing"

func TestImageMatchesContainer(t *testing.T) {
	img := &DockerImage{
		ID:         "sha256:abcdef0123456789ffff",
		Repository: "postgres",
		Tag:        "16",
		Ref:        "postgres:16",
	}
	cases := []struct {
		ci   string
		want bool
	}{
		{"postgres:16", true},
		{"postgres", true},
		{"postgres:15", false},
		{"abcdef012345", true},
		{"nginx:latest", false},
	}
	for _, tc := range cases {
		if got := imageMatchesContainer(img, tc.ci); got != tc.want {
			t.Fatalf("%q → %v want %v", tc.ci, got, tc.want)
		}
	}
}

func TestAttachImageUsage(t *testing.T) {
	inv := DockerInventory{
		Images: []DockerImage{{
			ID: "sha256:aaaabbbbccccdddd", Repository: "fw/app", Tag: "latest", Ref: "fw/app:latest",
		}},
		Containers: []DockerContainer{{
			Name: "fw-g-app", Image: "fw/app:latest", Group: "g", Service: "app",
		}},
	}
	attachImageUsage(&inv)
	img := inv.Images[0]
	if !img.InUse || img.Containers != 1 {
		t.Fatalf("in_use=%v containers=%d", img.InUse, img.Containers)
	}
	if len(img.Services) != 1 || img.Services[0] != "g/app" {
		t.Fatalf("services=%v", img.Services)
	}
}
