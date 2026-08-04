package deploy

import (
	"context"
	"fmt"
)

// executeQueuedCreate runs an infrastructure service creation after its FIFO
// slot is reserved. It owns releasing the slot and handing off to the next item.
func (m *Manager) executeQueuedCreate(ctx context.Context, next queuedDeploy) (Service, error) {
	var (
		svc Service
		err error
	)
	switch next.serviceType() {
	case TypePostgres:
		m.startProgress(CreatePostgresSteps())
		svc, err = m.createPostgres(ctx, next.group, next.name, next.version)
	case TypeBucket:
		m.startProgress(CreateBucketSteps())
		svc, err = m.createBucket(ctx, next.group, next.name)
	case TypeRedis:
		m.startProgress(CreateRedisSteps())
		svc, err = m.createRedis(ctx, next.group, next.name)
	default:
		err = fmt.Errorf("unsupported queued service type %q", next.serviceType())
	}
	if err != nil {
		m.releaseJob(false, err.Error())
		return Service{}, err
	}

	switch next.serviceType() {
	case TypePostgres:
		m.logf("ok", "Ready · link Go apps to get DB_* + DATABASE_URL")
		m.releaseJob(true, "Database ready · "+svc.Slug)
	case TypeBucket:
		m.logf("ok", "Ready · link a Go app for bucket variables")
		m.releaseJob(true, "Bucket ready · "+svc.Slug)
	case TypeRedis:
		m.releaseJob(true, "Redis ready · "+svc.Slug)
	}
	return svc, nil
}
