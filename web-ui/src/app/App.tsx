import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { fetchState } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { useRealtime } from '@/hooks/realtime'
import { ScrollMain } from '@/shell/PageTransition'
import { AppBar } from '@/shell/Shell'

const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage').then((m) => ({ default: m.ProjectsPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const FilesPage = lazy(() => import('@/features/files/FilesPage').then((m) => ({ default: m.FilesPage })))

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
  return (
    <div className="app-shell flex min-h-svh flex-col">
      <a href="#app-main" className="skip-link">Skip to content</a>
      <AppBar />
      <main id="app-main" tabIndex={-1} className="app-main">
        <ScrollMain />
        <OfflineNotice />
        <Suspense fallback={<Spinner label="Loading page…" />}>
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/projects/*" element={<ProjectsPage />} />
            <Route path="/files/*" element={<FilesPage />} />
            <Route path="/settings/*" element={<SettingsPage />} />
            <Route path="/activity/*" element={<Navigate to="/files" replace />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
