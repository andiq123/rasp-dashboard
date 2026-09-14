import { lazy, Suspense } from 'react'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useLiveState } from '@/hooks/useLiveState'
import { PageTransition, ScrollMain } from '@/shell/PageTransition'
import { Rail, Topbar } from '@/shell/Shell'
import { OverviewPage } from '@/features/overview/OverviewPage'
const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage').then(m => ({ default: m.ProjectsPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))
const FilesPage = lazy(() => import('@/features/files/FilesPage').then(m => ({ default: m.FilesPage })))
import { useActivity } from '@/hooks/useActivity'

export function App() {
  const { live, isError } = useLiveState()
  const { activity } = useActivity()

  return (
    <div className="app-shell flex min-h-svh bg-base-200 text-base-content">
      <a href="#app-main" className="skip-link">Skip to content</a>
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col min-h-svh">
        <Topbar live={live} activity={activity} />
        <main
          id="app-main"
          tabIndex={-1}
          className="app-main mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-7 lg:px-9"
        >
          <ScrollMain />
          {isError && !live ? <div role="status" className="mb-5 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm">Cannot reach this Pi. Displayed values may be unavailable or out of date. Reconnecting automatically.</div> : null}
          <PageTransition>
            <Suspense fallback={<Spinner label="Loading page…" />}><Routes>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/projects/*" element={<ProjectsPage />} />
              <Route path="/files/*" element={<FilesPage />} />
              <Route path="/settings/*" element={<SettingsPage />} />
              <Route path="/activity/*" element={<Navigate to="/files" replace />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes></Suspense>
          </PageTransition>
        </main>
      </div>
    </div>
  )
}
