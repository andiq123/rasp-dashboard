import { NavLink } from 'react-router-dom'
import {
  FolderKanban,
  LayoutDashboard,
  FolderOpen,
  Settings,
  Radio,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { muted } from '@/lib/ui'

const items: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Rail() {
  return (
    <aside className="w-16 sm:w-20 shrink-0 border-r border-base-300 bg-base-100">
      <nav className="flex h-full flex-col items-center gap-1 p-2 pt-3" aria-label="Main navigation">
        <div
          className="mb-3 grid h-10 w-10 place-items-center rounded-box bg-primary text-primary-content text-xs font-extrabold tracking-wide"
          aria-hidden
        >
          FW
        </div>
        {items.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                [
                  'flex w-full flex-col items-center gap-1 rounded-box px-1 py-2 text-[10px] font-semibold transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : `${muted} hover:bg-base-200 hover:text-base-content`,
                ].join(' ')
              }
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}

export function Topbar({ live }: { live: boolean }) {
  return (
    <header className="navbar min-h-14 border-b border-base-300 bg-base-100 px-4">
      <div className="flex-1">
        <div>
          <h1 className="text-lg font-bold tracking-tight leading-none">FireWifi</h1>
          <p className={`text-xs m-0 mt-0.5 ${muted}`}>Pi hotspot</p>
        </div>
      </div>
      <div className="flex-none">
        <div
          className={`badge badge-sm gap-1.5 ${live ? 'badge-success' : 'badge-ghost'}`}
          title={live ? 'Live updates connected' : 'Connecting to live updates'}
        >
          <Radio className="h-3 w-3" aria-hidden />
          {live ? 'Live' : 'Connecting'}
        </div>
      </div>
    </header>
  )
}
