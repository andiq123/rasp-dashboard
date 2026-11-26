import { Link, NavLink } from 'react-router-dom'
import { FolderKanban, FolderOpen, LayoutDashboard, Loader2, Settings, Wifi } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { phaseLabel } from '@/features/projects/serviceStatus'
import { useRealtime } from '@/hooks/realtime'
import { useActivity } from '@/hooks/useActivity'

const items: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppBar() {
  return (
    <header className="app-bar">
      <Link to="/overview" className="brand" aria-label="FireWifi home">
        <span className="brand-mark"><Wifi size={16} strokeWidth={2.4} aria-hidden /></span>
        <span className="hidden md:inline">FireWifi</span>
      </Link>
      <nav className="app-nav" aria-label="Main navigation">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} viewTransition className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
            {({ isActive }) => (
              <>
                {isActive ? <span className="nav-pill" aria-hidden /> : null}
                <Icon size={16} strokeWidth={1.9} aria-hidden />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="bar-status">
        <DeployChip />
        <LiveChip />
      </div>
    </header>
  )
}

/** Running deploy, visible from every page; opens the service being deployed. */
function DeployChip() {
  const { activity } = useActivity()
  if (!activity.active) return null
  const percent = Math.max(0, Math.min(100, Math.round(activity.progress?.percent || 0)))
  const [group, slug] = (activity.scope || '').split('/')
  const label = phaseLabel(activity.progress?.phase) || activity.progress?.label || activity.title || 'Deploying'
  const to = group ? `/projects/${encodeURIComponent(group)}${slug ? `/${encodeURIComponent(slug)}` : ''}` : '/projects'
  return (
    <Link to={to} className="deploy-chip text-info" role="status" title="Open live build">
      <span className="flex items-center gap-1.5 min-w-0 font-semibold">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
        <span className="truncate">{label} {slug || group || ''}</span>
        <span className="ml-auto font-mono tabular-nums">{percent}%</span>
      </span>
      <span className="meter" aria-hidden><span style={{ width: `${percent}%` }} /></span>
    </Link>
  )
}

function LiveChip() {
  const { live } = useRealtime()
  return (
    <span className={`live-chip ${live ? 'is-live' : ''}`} title={live ? 'Live updates connected' : 'Connecting to live updates'}>
      <span className="live-dot" aria-hidden />
      <span className="hidden sm:inline">{live ? 'Live' : 'Connecting'}</span>
      <span className="sr-only sm:hidden">{live ? 'Live' : 'Connecting'}</span>
    </span>
  )
}
