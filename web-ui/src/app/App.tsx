import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { fetchState } from '@/api/endpoints'
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

/** Fetch the other pages once the first one is idle, so switching never waits on a download. */
function usePreloadPages() {
  useEffect(() => {
    const run = () => void Promise.all([loadProjects(), loadFiles(), loadSettings()]).catch(() => {})
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(run, 1500)
    return () => clearTimeout(t)
  }, [])
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
  useIntro()
  usePreloadPages()
  const section = useAppSection()
  // Count section changes: the first page rides the intro, later ones rise in on their own.
  const [nav, setNav] = useState({ section, count: 0 })
  if (nav.section !== section) setNav({ section, count: nav.count + 1 })
  return (
    <div className="app-shell flex min-h-svh flex-col">
      <a href="#app-main" className="skip-link">Skip to content</a>
      <AppBar />
      <main id="app-main" tabIndex={-1} className="app-main">
        <ScrollMain />
        <OfflineNotice />
        <Suspense fallback={<Spinner label="Loading page…" />}>
          {/* Keyed by section: each page rises in once its content is ready, even after a lazy load. */}
          <div key={section} className={nav.count ? 'page-enter' : undefined}>
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
