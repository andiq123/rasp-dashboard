package deploy

import (
	"time"
)

// goDeployTimeout bounds one whole Go deploy (clone, build, start).
const goDeployTimeout = 25 * time.Minute

// Longer than the deploy budget so slow ARM Pi builds are not killed: deploys end
// by their own budget first.
const jobMaxAge = goDeployTimeout + 15*time.Minute

// BootstrapJobWatchdog clears jobs that never released (crash mid-delete, hung docker, …).
func (m *Manager) BootstrapJobWatchdog() {
	if m == nil {
		return
	}
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-m.bgDone():
			return
		case <-t.C:
			m.jobMu.Lock()
			busy := m.jobBusy
			started := m.jobStartedAt
			scope := m.jobScope
			m.jobMu.Unlock()
			if !busy || started.IsZero() {
				continue
			}
			if time.Since(started) < jobMaxAge {
				continue
			}
			m.logf("warn", "Clearing stuck job %q after %s", scope, jobMaxAge)
			m.forceClearJob("Job timed out — cleared automatically")
		}
	}
}
