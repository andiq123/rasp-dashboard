import { NavLink, useLocation } from 'react-router-dom'
import {
  FolderKanban,
  LayoutDashboard,
  FolderOpen,
  Settings,
  Radio,
  Wifi,
  Server,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ActivitySnapshot } from '@/api/types'
import { muted } from '@/lib/ui'
import { phaseLabel } from '@/features/projects/serviceStatus'
import { sectionTitles, useAppSection } from './PageTransition'

const items: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Rail() {
  return (
    <aside className="app-rail">
      <NavLink to="/overview" className="brand" aria-label="FireWifi home">
        <span className="brand-icon"><Wifi size={23} strokeWidth={2} aria-hidden /></span>
        <span className="rail-copy"><strong>FireWifi<span className="text-primary">.</span></strong><small>YOUR PI, CONNECTED</small></span>
      </NavLink>
      <div className="rail-caption rail-copy">WORKSPACE</div>
      <nav className="rail-nav" aria-label="Main navigation">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} title={label}
            className={({ isActive }) => `rail-link ${isActive ? 'is-active' : ''}`}>
            <Icon size={20} strokeWidth={1.75} aria-hidden />
            <span>{label}</span>
            <ChevronRight size={14} className="rail-chevron" aria-hidden />
          </NavLink>
        ))}
      </nav>
      <div className="rail-device rail-copy">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5"><Server size={18} aria-hidden /></span>
        <div><strong>Raspberry Pi</strong><small>Local workspace</small></div>
      </div>
    </aside>
  )
}

export function Topbar({ live, activity }: { live: boolean; activity: ActivitySnapshot }) {
  const section = useAppSection()
  const { pathname } = useLocation()
  const title = sectionTitles[section] || 'FireWifi'
  const crumb =
    section === 'projects' && pathname.split('/').filter(Boolean).length > 1
      ? 'Service'
      : section === 'files' && pathname.split('/').filter(Boolean).length > 1
        ? 'Browse'
        : null
  const deploying = activity.active
  const progress = Math.max(0, Math.min(100, activity.progress?.percent || 0))
  const scope = (activity.scope || '').split('/').filter(Boolean)
  const deployLabel = phaseLabel(activity.progress?.phase) || activity.progress?.label || activity.title || 'Deploying'
  const deployTarget = scope[1] || scope[0] || 'service'

  return (
    <header className={`navbar app-topbar shrink-0 border-b bg-base-100 px-4 sticky top-0 z-10 overflow-hidden ${deploying ? 'border-info/50' : 'border-base-300'}`}>
      <div className="flex-1 min-w-0">
        <div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-sm font-semibold tracking-tight leading-none truncate">{title}</span>
            {crumb ? <span className={`text-xs ${muted} truncate`}>{crumb}</span> : null}
          </div>
          <p className={`text-xs m-0 mt-1 ${muted}`}>Workspace / {crumb || "Dashboard"}</p>
        </div>
      </div>
      <div className="flex-none flex items-center gap-2 sm:gap-3">
        {deploying ? (
          <div className="hidden sm:grid min-w-[220px] max-w-[360px] gap-1" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 min-w-0 font-semibold text-info">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                <span className="truncate">{deployLabel} · {deployTarget}</span>
              </span>
              <span className="font-mono tabular-nums text-info">{progress}%</span>
            </div>
            <progress className="progress progress-info h-1 w-full" value={progress} max={100} />
          </div>
        ) : null}
        <div
          className={`badge badge-sm gap-1.5 transition-colors duration-300 ${live ? 'badge-success badge-soft' : 'badge-warning badge-soft'}`}
          title={live ? 'Live updates connected' : 'Connecting to live updates'}
        >
          <Radio className="h-3 w-3" aria-hidden />
          {live ? 'Live' : 'Connecting'}
        </div>
      </div>
      {deploying ? (
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 bg-info/15"
          aria-hidden
        >
          <span className="deploy-header-fill block h-full bg-info" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </header>
  )
}
