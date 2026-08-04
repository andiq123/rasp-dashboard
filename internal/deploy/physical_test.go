package deploy

import "testing"

func TestPhysicalDatabaseName_noJoinCollision(t *testing.T) {
	a := physicalDatabaseName("a", "b-c")
	b := physicalDatabaseName("a-b", "c")
	if a == "" || b == "" {
		t.Fatal("empty name")
	}
	if a == b {
		t.Fatalf("collision: both %q", a)
	}
	if a != "a__b_c" || b != "a_b__c" {
		t.Fatalf("got %q and %q", a, b)
	}
}

func TestPhysicalBucketName_noJoinCollision(t *testing.T) {
	a := physicalBucketName("a", "b-c")
	b := physicalBucketName("a-b", "c")
	if a == b {
		t.Fatalf("collision: both %q", a)
	}
	if a != "a--b-c" || b != "a-b--c" {
		t.Fatalf("got %q and %q", a, b)
	}
}

func TestPhysicalNames_groupScoped(t *testing.T) {
	if got := physicalDatabaseName("driver-logs", "uploads"); got != "driver_logs__uploads" {
		t.Fatalf("db=%q", got)
	}
	if got := physicalBucketName("driver-logs", "uploads"); got != "driver-logs--uploads" {
		t.Fatalf("bucket=%q", got)
	}
	if got := physicalBucketName("driver-logs", "driver-logs"); got != "driver-logs--driver-logs" {
		t.Fatalf("bucket=%q", got)
	}
	if got := physicalDatabaseName("999scraper", "data"); got != "db_999scraper__data" {
		t.Fatalf("numeric group db=%q", got)
	}
	if got := physicalBucketName("999scraper", "files"); got != "999scraper--files" {
		t.Fatalf("numeric group bucket=%q", got)
	}
}

func TestFitPhysicalName_stableHash(t *testing.T) {
	long := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	a := fitPhysicalName(long+"-one", 40, "-")
	b := fitPhysicalName(long+"-two", 40, "-")
	if a == b || len(a) > 40 || len(b) > 40 {
		t.Fatalf("a=%q b=%q", a, b)
	}
	if fitPhysicalName(long+"-one", 40, "-") != a {
		t.Fatal("not stable")
	}
}

func TestRegistryPhysicalTaken(t *testing.T) {
	reg := registry{Services: []Service{
		{Group: "g1", Slug: "db", Type: TypePostgres, Database: "g1__db"},
		{Group: "g2", Slug: "files", Type: TypeBucket, Bucket: "g2--files"},
	}}
	if !registryPhysicalTaken(reg, TypePostgres, "g1__db", "", "") {
		t.Fatal("expected db taken")
	}
	if registryPhysicalTaken(reg, TypePostgres, "g1__db", "g1", "db") {
		t.Fatal("except owner should be free")
	}
	if !registryPhysicalTaken(reg, TypeBucket, "g2--files", "", "") {
		t.Fatal("expected bucket taken")
	}
}
