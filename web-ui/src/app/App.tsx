import { Navigate, Route, Routes } from 'react-router-dom'
import { useLiveState } from '@/hooks/useLiveState'
import { Rail, Topbar } from '@/shell/Shell'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { FilesPage } from '@/features/files/FilesPage'

export function App() {
  const { live } = useLiveState()

  return (
    <div className="flex min-h-screen bg-base-200 text-base-content">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar live={live} />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-4 sm:px-5 sm:py-5">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/projects/*" element={<ProjectsPage />} />
            <Route path="/files/*" element={<FilesPage />} />
            <Route path="/settings/*" element={<SettingsPage />} />
            <Route path="/activity/*" element={<Navigate to="/files" replace />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
