import { Navigate, Route, Routes } from 'react-router-dom'
import { useLiveState } from '@/hooks/useLiveState'
import { PageTransition, ScrollMain } from '@/shell/PageTransition'
import { Rail, Topbar } from '@/shell/Shell'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { FilesPage } from '@/features/files/FilesPage'
import { useActivity } from '@/hooks/useActivity'

export function App() {
  const { live } = useLiveState()
  const { activity } = useActivity()

  return (
    <div className="flex min-h-svh bg-base-200 text-base-content">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col min-h-svh">
        <Topbar live={live} activity={activity} />
        <main
          id="app-main"
          className="mx-auto w-full max-w-[1440px] flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5"
        >
          <ScrollMain />
          <PageTransition>
            <Routes>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/projects/*" element={<ProjectsPage />} />
              <Route path="/files/*" element={<FilesPage />} />
              <Route path="/settings/*" element={<SettingsPage />} />
              <Route path="/activity/*" element={<Navigate to="/files" replace />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </PageTransition>
        </main>
      </div>
    </div>
  )
}
