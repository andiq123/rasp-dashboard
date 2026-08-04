import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleStop,
  Cpu,
  HardDrive,
  MemoryStick,
  Play,
  RotateCw,
  Shield,
  Thermometer,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import {
  fetchConfig,
  fetchGroups,
  fetchServices,
  hotspotAction,
  saveConfig,
  setMode,
  syncroxAction,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { Service } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input } from '@/components/ui/Field/Field'
import { Panel } from '@/components/ui/Panel/Panel'
import { ResourceBudget } from '@/components/ui/ResourceBudget/ResourceBudget'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { useLiveState } from '@/hooks/useLiveState'
import { actionDoneLabel } from '@/lib/actions'
import { fmtBytes, fmtPct, fmtRate } from '@/lib/format'
import { hostCapacity, reservedFromServices } from '@/lib/resources'
import { muted, tile } from '@/lib/ui'

function Metric({
  label,
  value,
  detail,
  percent,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  percent: number
  icon: LucideIcon
}) {
  const p = Math.max(0, Math.min(100, percent || 0))
  return (
    <div className={`${tile} px-2.5 py-2`}>
      <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${muted}`}>
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        {label}
      </div>
      <div className="text-lg font-bold tracking-tight leading-tight mt-0.5">{value}</div>
      <div className={`text-[11px] ${muted} truncate`}>{detail}</div>
      <progress className="progress progress-primary w-full mt-1.5 h-1" value={p} max={100} />
    </div>
  )
}

export function OverviewPage() {
  const { state, live } = useLiveState()
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const configQ = useQuery({ queryKey: queryKeys.config, queryFn: fetchConfig })
  const groupsQ = useQuery({ queryKey: queryKeys.groups, queryFn: fetchGroups })
  const groupList = groupsQ.data || []
  const svcQueries = useQueries({
    queries: groupList.map((g) => ({
      queryKey: queryKeys.services(g.slug),
      queryFn: () => fetchServices(g.slug),
      staleTime: 10_000,
    })),
  })
  const allServices: Service[] = svcQueries.flatMap((q) => q.data || [])
  const host = hostCapacity(state.device_metrics)
  const reserved = reservedFromServices(allServices)

  const mode = state.mode || 'mullvad'
  const d = state.device_metrics || {}
  const cpu = d.cpu || {}
  const mem = d.memory || {}
  const thermal = d.thermal || {}
  const storage = d.storage || {}
  const net = d.network || {}
  const temp = Number(thermal.temperature_celsius || 0)
  const vpn = state.vpn_health || {}
  const issues = state.issues || []
  const vpnHealthy = state.vpn_health
    ? !!(vpn.interface_up && vpn.handshake_healthy && vpn.egress_ok)
    : !!state.wg_up
  const healthy = !!(state.hotspot_running && (mode === 'mullvad' ? vpnHealthy : state.proxy_running))

  const modeMut = useMutation({
    mutationFn: (m: string) => setMode(m),
    onSuccess: async () => {
      showToast('Mode updated')
      await qc.invalidateQueries({ queryKey: queryKeys.state })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const hs = useMutation({
    mutationFn: (a: 'start' | 'stop' | 'restart' | 'repair-vpn') => hotspotAction(a),
    onSuccess: async (_, a) => {
      showToast(a === 'repair-vpn' ? 'VPN repaired and verified' : `Hotspot ${actionDoneLabel(a).toLowerCase()}`)
      await qc.invalidateQueries({ queryKey: queryKeys.state })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const sx = useMutation({
    mutationFn: (a: 'start' | 'stop') => syncroxAction(a),
    onSuccess: async (_, a) => {
      showToast(`Syncrox ${actionDoneLabel(a).toLowerCase()}`)
      await qc.invalidateQueries({ queryKey: queryKeys.state })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const save = useMutation({
    mutationFn: (fd: FormData) => {
      const body: Record<string, string> = {}
      fd.forEach((v, k) => {
        if (typeof v === 'string') body[k] = v
      })
      return saveConfig(body)
    },
    onSuccess: async () => {
      showToast('Hotspot settings saved')
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.config }),
        qc.invalidateQueries({ queryKey: queryKeys.state }),
      ])
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  async function onMode(next: string) {
    if (next === mode) return
    const ok = await confirm({
      title: `Switch to ${next === 'residential' ? 'Residential' : 'Mullvad'}?`,
      body: 'Active clients may briefly drop while the route changes.',
      confirmLabel: 'Switch',
    })
    if (ok) modeMut.mutate(next)
  }

  async function onHotspot(a: 'start' | 'stop' | 'restart') {
    if (a === 'start') {
      hs.mutate(a)
      return
    }
    const ok = await confirm({
      title: a === 'stop' ? 'Stop hotspot?' : 'Restart hotspot?',
      body: a === 'stop' ? 'Connected devices will lose Wi‑Fi until you start it again.' : 'Clients may disconnect briefly.',
      confirmLabel: a === 'stop' ? 'Stop' : 'Restart',
      danger: a === 'stop',
    })
    if (ok) hs.mutate(a)
  }

  async function onRepairVPN() {
    const ok = await confirm({
      title: 'Repair Mullvad VPN?',
      body: 'The Pi will refresh the saved relay, restart only WireGuard, and verify a fresh handshake. Wi‑Fi clients may briefly lose internet.',
      confirmLabel: 'Repair VPN',
    })
    if (ok) hs.mutate('repair-vpn')
  }

  async function onSyncrox() {
    if (!state.syncrox_running) {
      sx.mutate('start')
      return
    }
    const ok = await confirm({
      title: 'Stop Syncrox?',
      body: 'Port :5090 will stop accepting connections.',
      confirmLabel: 'Stop',
      danger: true,
    })
    if (ok) sx.mutate('stop')
  }

  const c = configQ.data || {}
  const busy = modeMut.isPending || hs.isPending || sx.isPending || save.isPending

  return (
    <div className="grid gap-3 lg:grid-cols-2 items-start">
      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" aria-hidden />
            {mode === 'residential' ? 'Residential' : 'Mullvad'}
          </span>
        }
        hint={mode === 'residential' ? 'Proxy route' : 'WireGuard route'}
        busy={busy}
      >
        <div className="flex items-center justify-between gap-2">
          <p className={`text-xs m-0 ${muted}`}>
            {mode === 'residential' ? 'SOCKS via hotspot' : 'WG via hotspot'}
          </p>
          <div className={`badge badge-sm gap-1.5 ${healthy ? 'badge-success' : 'badge-error'}`}>
            <span className={`status ${healthy ? 'status-success' : 'status-error'}`} />
            {healthy ? 'Online' : 'Offline'}
          </div>
        </div>

        {issues.length > 0 ? (
          <div className="grid gap-1.5" aria-label="Detected issues">
            {issues.map((issue) => (
              <div
                key={issue.code}
                className={`rounded-lg border px-2.5 py-2 ${
                  issue.severity === 'critical'
                    ? 'border-error/35 bg-error/10'
                    : 'border-warning/35 bg-warning/10'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="flex items-center gap-1.5 text-xs">
                      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {issue.title}
                    </strong>
                    <p className={`m-0 mt-1 text-[11px] leading-snug ${muted}`}>{issue.detail}</p>
                  </div>
                  {issue.action === 'repair-vpn' ? (
                    <Button
                      variant="warningSoft"
                      icon={<Wrench className="h-3.5 w-3.5" aria-hidden />}
                      loading={hs.isPending && hs.variables === 'repair-vpn'}
                      onClick={() => void onRepairVPN()}
                    >
                      Repair VPN
                    </Button>
                  ) : issue.action === 'restart-hotspot' ? (
                    <Button
                      variant="warningSoft"
                      loading={hs.isPending && hs.variables === 'restart'}
                      onClick={() => void onHotspot('restart')}
                    >
                      Restart
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-success/25 bg-success/10 px-2.5 py-2 text-xs">
            No active hotspot or route issues detected.
          </div>
        )}

        <div className="join w-full">
          <Button
            className="join-item flex-1"
            variant={mode === 'mullvad' ? 'primary' : 'quiet'}
            disabled={modeMut.isPending}
            loading={modeMut.isPending && modeMut.variables === 'mullvad'}
            onClick={() => void onMode('mullvad')}
          >
            Mullvad
          </Button>
          <Button
            className="join-item flex-1"
            variant={mode === 'residential' ? 'primary' : 'quiet'}
            disabled={modeMut.isPending}
            loading={modeMut.isPending && modeMut.variables === 'residential'}
            onClick={() => void onMode('residential')}
          >
            Residential
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="successSoft"
            icon={<Play className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
            disabled={state.hotspot_running}
            loading={hs.isPending && hs.variables === 'start'}
            onClick={() => void onHotspot('start')}
          >
            Start
          </Button>
          <Button
            variant="dangerSoft"
            icon={<CircleStop className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
            disabled={!state.hotspot_running}
            loading={hs.isPending && hs.variables === 'stop'}
            onClick={() => void onHotspot('stop')}
          >
            Stop
          </Button>
          <Button
            variant="warningSoft"
            icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
            loading={hs.isPending && hs.variables === 'restart'}
            onClick={() => void onHotspot('restart')}
          >
            Restart
          </Button>
        </div>

        <div className={`overflow-hidden ${tile} divide-y divide-base-300`}>
          {[
            ['SSID', state.ssid || '—'],
            ['Gateway', state.hotspot_ip || '—'],
            [
              'DHCP',
              state.dhcp_start && state.dhcp_end ? `${state.dhcp_start} – ${state.dhcp_end}` : 'Not set',
            ],
            ...(mode === 'mullvad'
              ? [
                  ['Relay', vpn.relay || 'Unknown'],
                  [
                    'Handshake',
                    vpn.handshake_healthy
                      ? `${Number(vpn.handshake_age_seconds || 0)}s ago`
                      : 'Stale or missing',
                  ],
                  ['Mullvad egress', vpn.egress_ok ? 'Verified' : 'Failed'],
                ]
              : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-2.5 py-2 bg-base-100/60">
              <span className={`${muted} text-xs`}>{k}</span>
              <strong className="text-xs font-semibold">{v}</strong>
            </div>
          ))}
        </div>

        <details className={`collapse collapse-arrow ${tile}`}>
          <summary className="collapse-title text-xs font-semibold min-h-0 py-2.5">
            Edit hotspot settings
          </summary>
          <div className="collapse-content">
            {configQ.isLoading ? (
              <Spinner compact label="Loading settings…" />
            ) : configQ.isError ? (
              <Empty
                compact
                title="Could not load settings"
                body={(configQ.error as Error).message}
                action={
                  <Button variant="infoSoft" onClick={() => void configQ.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : (
              <form
                className="grid gap-2 pt-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  save.mutate(new FormData(e.currentTarget))
                }}
              >
                <Field label="SSID" tip="Wi‑Fi network name broadcast by this Pi.">
                  <Input name="ssid" defaultValue={c.ssid || state.ssid || ''} />
                </Field>
                <Field label="Password" tip={c.password_set ? 'Unchanged if left blank' : 'At least 8 characters for WPA2.'}>
                  <Input name="password" type="password" autoComplete="new-password" />
                </Field>
                <Field label="Gateway IP" tip="Hotspot interface address (clients use this as gateway).">
                  <Input name="hotspot_ip" defaultValue={c.hotspot_ip || state.hotspot_ip || ''} />
                </Field>
                <Field label="DHCP start" tip="First address handed out to clients.">
                  <Input name="dhcp_start" defaultValue={c.dhcp_start || state.dhcp_start || ''} />
                </Field>
                <Field label="DHCP end" tip="Last address in the DHCP pool.">
                  <Input name="dhcp_end" defaultValue={c.dhcp_end || state.dhcp_end || ''} />
                </Field>
                <Button type="submit" variant="primary" loading={save.isPending}>
                  Save
                </Button>
              </form>
            )}
          </div>
        </details>

        <div className="flex items-center justify-between gap-3 border-t border-base-300 pt-2.5">
          <div>
            <strong className="block text-sm">Syncrox</strong>
            <p className={`text-xs ${muted} m-0 mt-0.5`}>
              {state.syncrox_running ? 'Running on :5090' : 'Stopped'}
            </p>
          </div>
          <Button
            variant={state.syncrox_running ? 'dangerSoft' : 'successSoft'}
            loading={sx.isPending}
            onClick={() => void onSyncrox()}
          >
            {state.syncrox_running ? 'Stop' : 'Start'}
          </Button>
        </div>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" aria-hidden /> System
          </span>
        }
        hint={live ? 'Live' : 'Connecting…'}
      >
        <div className="grid grid-cols-2 gap-1.5">
          <Metric
            icon={Cpu}
            label="CPU"
            value={fmtPct(cpu.busy_percent)}
            detail={`Idle ${fmtPct(cpu.idle_percent)}`}
            percent={cpu.busy_percent || 0}
          />
          <Metric
            icon={MemoryStick}
            label="Memory"
            value={fmtPct(mem.used_percent)}
            detail={fmtBytes(mem.used_bytes)}
            percent={mem.used_percent || 0}
          />
          <Metric
            icon={Thermometer}
            label="Thermal"
            value={thermal.available ? `${temp.toFixed(0)}°` : 'n/a'}
            detail={
              thermal.throttle_known
                ? thermal.throttled
                  ? 'Throttled now'
                  : thermal.throttled_before
                    ? 'OK now · past event'
                    : 'OK'
                : 'Sensor'
            }
            percent={(temp / 85) * 100}
          />
          <Metric
            icon={HardDrive}
            label="Disk"
            value={fmtPct(storage.used_percent)}
            detail={fmtBytes(storage.used_bytes)}
            percent={storage.used_percent || 0}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className={`${tile} px-2.5 py-2`}>
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase ${muted}`}>
              <ArrowDownToLine className="h-3 w-3" aria-hidden /> Down
            </span>
            <strong className="block text-sm mt-0.5">{fmtRate(net.down_bytes_per_sec)}</strong>
          </div>
          <div className={`${tile} px-2.5 py-2`}>
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase ${muted}`}>
              <ArrowUpFromLine className="h-3 w-3" aria-hidden /> Up
            </span>
            <strong className="block text-sm mt-0.5">{fmtRate(net.up_bytes_per_sec)}</strong>
          </div>
        </div>
        <ResourceBudget host={host} reserved={reserved} compact />
      </Panel>
    </div>
  )
}
