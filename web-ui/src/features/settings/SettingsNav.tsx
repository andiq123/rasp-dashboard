import { useQuery } from '@tanstack/react-query'
import { Bell, Plug, Server, type LucideIcon } from 'lucide-react'
import { fetchAlerts, fetchGitHubStatus, fetchManage, fetchMullvadAccount, fetchResidential } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { fmtGB } from '@/lib/format'
import { daysLeftText, daysLeftTone } from '@/lib/mullvad'

export type SettingsSection = 'connections' | 'alerts' | 'system'

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'system', label: 'System', icon: Server },
]

/** The section an address points at; earlier section names land on Connections. */
export function sectionFrom(v: string | undefined): SettingsSection {
  if (v === 'alerts' || v === 'system') return v
  return 'connections'
}

type Status = { text: string; tone?: 'ok' | 'warn' | 'bad' }

/** One live line per section, from the same cached queries the panels use. */
function useStatuses(): Record<SettingsSection, Status | null> {
  const gh = useQuery({ queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus })
  const acct = useQuery({ queryKey: queryKeys.mullvadAccount, queryFn: fetchMullvadAccount })
  const res = useQuery({ queryKey: queryKeys.residential, queryFn: fetchResidential })
  const alerts = useQuery({ queryKey: queryKeys.alerts, queryFn: fetchAlerts })
  const manage = useQuery({ queryKey: queryKeys.manage, queryFn: fetchManage })

  // Connections reports the most urgent of its services.
  const mullvadTone = daysLeftTone(acct.data)
  const left = res.data?.remaining_bytes
  const parts: string[] = []
  let tone: Status['tone'] = 'ok'
  const worse = (t: Status['tone']) => {
    const rank = { ok: 0, warn: 1, bad: 2 } as const
    if (t && rank[t] > rank[tone ?? 'ok']) tone = t
  }
  if (gh.data && !gh.data.connected) {
    parts.push('GitHub not connected')
    worse('warn')
  }
  if (acct.data?.configured) {
    parts.push(daysLeftText(acct.data))
    worse(mullvadTone === 'bad' ? 'bad' : mullvadTone === 'warn' ? 'warn' : 'ok')
  }
  if (left != null) {
    parts.push(`${fmtGB(left)} left`)
    worse(left < 200e6 ? 'bad' : left < 1e9 ? 'warn' : 'ok')
  }
  return {
    connections: parts.length ? { text: parts.join(', '), tone } : null,
    alerts: alerts.data
      ? alerts.data.enabled
        ? alerts.data.active.length ? { text: `${alerts.data.active.length} open`, tone: 'warn' } : { text: 'On', tone: 'ok' }
        : { text: 'Off', tone: 'warn' }
      : null,
    system: manage.data?.daemon
      ? manage.data.daemon.running ? { text: 'Docker running', tone: 'ok' } : { text: 'Docker stopped', tone: 'bad' }
      : null,
  }
}

/** Sections of Settings; a sidebar on wide screens, a scrolling strip on phones. */
export function SettingsNav({ current, onPick }: { current: SettingsSection; onPick: (id: SettingsSection) => void }) {
  const status = useStatuses()
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {SECTIONS.map((s) => {
        const st = status[s.id]
        return (
          <button
            key={s.id}
            type="button"
            className={`settings-nav-item${current === s.id ? ' is-active' : ''}`}
            aria-current={current === s.id ? 'page' : undefined}
            onClick={() => onPick(s.id)}
          >
            <span className="settings-nav-icon"><s.icon aria-hidden /></span>
            <span className="settings-nav-text">
              <strong>{s.label}</strong>
              <small className={st?.tone ? `tone-${st.tone}` : undefined}>{st?.text ?? ' '}</small>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
