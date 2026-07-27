import { Navigate, Route, Routes } from 'react-router-dom'
import { useLiveState } from '@/hooks/useLiveState'
import { Rail, Topbar } from '@/shell/Shell'
import shell from '@/shell/Shell.module.css'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { FilesPage } from '@/features/files/FilesPage'

export function App() {
  const { live } = useLiveState()

  return (
    <div className={shell.shell}>
      <Rail />
      <div className={shell.body}>
        <Topbar live={live} />
        <main className={shell.content}>
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
