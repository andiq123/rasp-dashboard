import { lazy, Suspense, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { fetchAlerts, fetchDashboardTunnel, fetchEngine, fetchGitHubStatus, fetchManage, fetchMullvadAccount, fetchState } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { useRealtime } from '@/hooks/realtime'
import { ScrollMain, useAppSection } from '@/shell/PageTransition'
import { AppBar } from '@/shell/Shell'
import { useIntro } from '@/shell/useIntro'

const loadProjects = () => import('@/features/projects/ProjectsPage')
const loadSettings = () => import('@/features/settings/SettingsPage')
const loadFiles = () => import('@/features/files/FilesPage')
const ProjectsPage = lazy(() => loadProjects().then((m) => ({ default: m.ProjectsPage })))
const SettingsPage = lazy(() => loadSettings().then((m) => ({ default: m.SettingsPage })))
const FilesPage = lazy(() => loadFiles().then((m) => ({ default: m.FilesPage })))

/** Data every Settings widget needs, warmed in the background so the page opens complete. */
const settingsQueries = [
  { queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus },
  { queryKey: queryKeys.engine, queryFn: fetchEngine },
  { queryKey: queryKeys.mullvadAccount, queryFn: fetchMullvadAccount },
  { queryKey: queryKeys.alerts, queryFn: fetchAlerts },
  { queryKey: queryKeys.dashboardTunnel, queryFn: fetchDashboardTunnel },
  { queryKey: queryKeys.manage, queryFn: fetchManage },
] as const

/**
 * Once the first page is idle, fetch the other pages' code and the Settings
 * data, so switching never waits on a download or shows a loading state.
 */
function usePreloadPages() {
  const qc = useQueryClient()
  useEffect(() => {
    const run = () => {
      void Promise.all([loadProjects(), loadFiles(), loadSettings()]).catch(() => {})
      for (const q of settingsQueries) void qc.prefetchQuery(q as Parameters<typeof qc.prefetchQuery>[0])
    }
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(run, 1500)
    return () => clearTimeout(t)
  }, [qc])
}

/** Only re-renders when reachability flips, not on every live state tick. */
function OfflineNotice() {
  const { live } = useRealtime()
  const { isError } = useQuery({
    queryKey: queryKeys.state,
    queryFn: fetchState,
    enabled: false,
    notifyOnChangeProps: ['isError'],
  })
  if (!isError || live) return null
  return (
    <div role="status" className="mb-4 rounded-box border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm">
      Can't reach this Pi. Values may be out of date. Reconnecting automatically.
    </div>
  )
}

export function App() {
  const section = useAppSection()
  useIntro(section)
  usePreloadPages()
  return (
    <div className="app-shell flex min-h-svh flex-col">
      <a href="#app-main" className="skip-link">Skip to content</a>
      <AppBar />
      <main id="app-main" tabIndex={-1} className="app-main">
        <ScrollMain />
        <OfflineNotice />
        <Suspense fallback={<Spinner label="Loading page…" />}>
          {/* Keyed by section: each page mounts fresh, and its widgets rise in via useIntro. */}
          <div key={section}>
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/projects/*" element={<ProjectsPage />} />
            <Route path="/files/*" element={<FilesPage />} />
            <Route path="/settings/*" element={<SettingsPage />} />
            <Route path="/activity/*" element={<Navigate to="/files" replace />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
          </div>
        </Suspense>
      </main>
    </div>
  )
}
