package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (m *Manager) CreateBucket(ctx context.Context, group, name string) (Service, error) {
	name = strings.TrimSpace(name)
	scope := group + "/" + slugify(name)
	if err := m.acquireJob("Create bucket · "+name, scope); err != nil {
		return Service{}, err
	}
	m.startProgress(CreateBucketSteps())
	svc, err := m.createBucket(ctx, group, name)
	if err != nil {
		m.releaseJob(false, err.Error())
		return Service{}, err
	}
	m.logf("ok", "Ready · link a Go app to get BUCKET_URL")
	m.releaseJob(true, "Bucket ready · "+svc.Slug)
	return svc, nil
}

func (m *Manager) createBucket(ctx context.Context, group, name string) (Service, error) {
	m.stepProgress("prepare")
	m.detailProgress("Checking group")
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.MinIO == nil {
		return Service{}, fmt.Errorf("minio engine not configured")
	}
	reg, err := m.loadRegistry()
	if err != nil {
		return Service{}, err
	}
	if _, idx := findGroup(reg, group); idx < 0 {
		return Service{}, fmt.Errorf("group not found — create a group first")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Service{}, fmt.Errorf("name required")
	}
	slug := slugify(name)
	if slug == "" {
		return Service{}, fmt.Errorf("invalid name")
	}
	if _, idx := findService(reg, group, slug); idx >= 0 {
		return Service{}, fmt.Errorf("service already exists in group")
	}
	m.logf("info", "New bucket · %s/%s", group, slug)

	m.stepProgress("engine")
	m.detailProgress("Ensuring MinIO")
	m.mu.Unlock()
	m.logf("step", "Starting MinIO engine if needed")
	if err := m.MinIO.Start(ctx); err != nil {
		m.mu.Lock()
		return Service{}, fmt.Errorf("engine: %w", err)
	}
	m.logf("ok", "Engine healthy · 127.0.0.1:9000")

	phys := strings.ReplaceAll(group+"-"+slug, "_", "-")
	if len(phys) > 60 {
		phys = phys[:60]
	}
	m.stepProgress("bucket")
	m.detailProgress(phys)
	m.logf("step", "Creating bucket %s", phys)
	info, err := m.MinIO.CreateBucket(ctx, phys)
	m.mu.Lock()
	if err != nil {
		return Service{}, err
	}
	m.logf("ok", "Bucket %s created", info.Name)

	m.stepProgress("register")
	m.detailProgress("Writing env")
	dir := m.serviceDir(group, slug)
	if err := m.ensureServiceLayout(group, slug); err != nil {
		_ = m.MinIO.DeleteBucket(ctx, info.Name)
		return Service{}, err
	}
	envBody := ensureProductionEnv(bucketServiceEnv(info.Name, info.Endpoint, info.AccessKey, info.SecretKey))
	if err := os.WriteFile(filepath.Join(dir, "env"), []byte(envBody), 0o600); err != nil {
		_ = m.MinIO.DeleteBucket(ctx, info.Name)
		return Service{}, err
	}
	bucketURL := buildBucketURL(info.Endpoint, info.AccessKey, info.SecretKey, info.Name)
	svc := Service{
		Group: group, Slug: slug, Type: TypeBucket, Name: name,
		Running: true, Bucket: info.Name, ConnectionURL: bucketURL,
		Status: "running", UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := m.writeMeta(svc); err != nil {
		return Service{}, err
	}
	reg.Services = append(reg.Services, svc)
	if err := m.saveRegistry(reg); err != nil {
		return Service{}, err
	}
	return svc, nil
}
