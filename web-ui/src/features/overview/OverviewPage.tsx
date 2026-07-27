import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Play,
  RefreshCw,
  Shield,
  Square,
} from 'lucide-react'
import {
  fetchConfig,
  hotspotAction,
  saveConfig,
  setMode,
  syncroxAction,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { Field, Input } from '@/components/ui/Field/Field'
import { Panel } from '@/components/ui/Panel/Panel'
import { useToast } from '@/components/ui/Toast/Toast'
import { useLiveState } from '@/hooks/useLiveState'
import { fmtBytes, fmtPct, fmtRate } from '@/lib/format'
import { muted, tile } from '@/lib/ui'

function Metric({
  label,
  value,
  detail,
  percent,
}: {
  label: string
  value: string
  detail: string
  percent: number
}) {
  const p = Math.max(0, Math.min(100, percent || 0))
  return (
    <div className={`${tile} p-3`}>
      <div className={`text-[11px] font-bold uppercase tracking-wide ${muted}`}>{label}</div>
      <div className="text-xl font-bold tracking-tight">{value}</div>
      <div className={`text-xs ${muted} mt-0.5`}>{detail}</div>
      <progress className="progress progress-primary w-full mt-2 h-1.5" value={p} max={100} />
    </div>
  )
}

export function OverviewPage() {
  const { state } = useLiveState()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const configQ = useQuery({ queryKey: queryKeys.config, queryFn: fetchConfig })

  const mode = state.mode || 'mullvad'
  const d = state.device_metrics || {}
  const cpu = d.cpu || {}
  const mem = d.memory || {}
  const thermal = d.thermal || {}
  const storage = d.storage || {}
  const net = d.network || {}
  const temp = Number(thermal.temperature_celsius || 0)
  const healthy = !!(state.hotspot_running && (mode === 'mullvad' ? state.wg_up : state.proxy_running))

  const modeMut = useMutation({
    mutationFn: (m: string) => setMode(m),
    onSuccess: async () => {
      showToast('Mode updated')
      await qc.invalidateQueries({ queryKey: queryKeys.state })
    },
    onError: (e: Error) => showToast(e.message),
  })

  const hs = useMutation({
    mutationFn: (a: 'start' | 'stop' | 'restart') => hotspotAction(a),
    onSuccess: async (_, a) => {
      showToast(`Hotspot ${a}`)
      await qc.invalidateQueries({ queryKey: queryKeys.state })
    },
    onError: (e: Error) => showToast(e.message),
  })

  const sx = useMutation({
    mutationFn: (a: 'start' | 'stop') => syncroxAction(a),
    onSuccess: async (_, a) => {
      showToast(`Syncrox ${a}`)
      await qc.invalidateQueries({ queryKey: queryKeys.state })
    },
    onError: (e: Error) => showToast(e.message),
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
      showToast('Settings saved')
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.config }),
        qc.invalidateQueries({ queryKey: queryKeys.state }),
      ])
    },
    onError: (e: Error) => showToast(e.message),
  })

  const c = configQ.data || {}

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Shield className="h-4 w-4" aria-hidden />
            {mode === 'residential' ? 'Residential' : 'Mullvad'}
          </span>
        }
        hint={mode === 'residential' ? 'Proxy route' : 'WireGuard route'}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold tracking-tight">
              {mode === 'residential' ? 'Residential' : 'Mullvad'}
            </div>
            <div className={`text-xs ${muted}`}>
              {mode === 'residential' ? 'SOCKS via hotspot' : 'WG via hotspot'}
            </div>
          </div>
          <div className={`badge gap-1.5 ${healthy ? 'badge-success' : 'badge-error'}`}>
            <span className={`status ${healthy ? 'status-success' : 'status-error'}`} />
            {healthy ? 'Online' : 'Offline'}
          </div>
        </div>

        <div className="join w-full">
          <Button
            className="join-item flex-1"
            variant={mode === 'mullvad' ? 'primary' : 'quiet'}
            disabled={modeMut.isPending}
            onClick={() => modeMut.mutate('mullvad')}
          >
            Mullvad
          </Button>
          <Button
            className="join-item flex-1"
            variant={mode === 'residential' ? 'primary' : 'quiet'}
            disabled={modeMut.isPending}
            onClick={() => modeMut.mutate('residential')}
          >
            Residential
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<Play className="h-4 w-4" />}
            disabled={state.hotspot_running}
            loading={hs.isPending && hs.variables === 'start'}
            onClick={() => hs.mutate('start')}
          >
            Start
          </Button>
          <Button
            variant="dangerSoft"
            icon={<Square className="h-4 w-4" />}
            disabled={!state.hotspot_running}
            loading={hs.isPending && hs.variables === 'stop'}
            onClick={() => hs.mutate('stop')}
          >
            Stop
          </Button>
          <Button
            variant="quiet"
            icon={<RefreshCw className="h-4 w-4" />}
            loading={hs.isPending && hs.variables === 'restart'}
            onClick={() => hs.mutate('restart')}
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
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-3 py-2.5 bg-base-100/60">
              <span className={`${muted} text-sm`}>{k}</span>
              <strong className="text-sm font-semibold">{v}</strong>
            </div>
          ))}
        </div>

        <details className={`collapse collapse-arrow ${tile}`}>
          <summary className="collapse-title text-sm font-semibold min-h-0 py-3">
            Edit hotspot settings
          </summary>
          <div className="collapse-content">
            <form
              className="grid gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault()
                save.mutate(new FormData(e.currentTarget))
              }}
            >
              <Field label="SSID">
                <Input name="ssid" defaultValue={c.ssid || state.ssid || ''} />
              </Field>
              <Field label="Password" tip={c.password_set ? 'Unchanged if left blank' : undefined}>
                <Input name="password" type="password" autoComplete="new-password" />
              </Field>
              <Field label="Gateway IP">
                <Input name="hotspot_ip" defaultValue={c.hotspot_ip || state.hotspot_ip || ''} />
              </Field>
              <Field label="DHCP start">
                <Input name="dhcp_start" defaultValue={c.dhcp_start || state.dhcp_start || ''} />
              </Field>
              <Field label="DHCP end">
                <Input name="dhcp_end" defaultValue={c.dhcp_end || state.dhcp_end || ''} />
              </Field>
              <Button type="submit" variant="primary" loading={save.isPending}>
                Save
              </Button>
            </form>
          </div>
        </details>

        <div className="flex items-center justify-between gap-3 border-t border-base-300 pt-3">
          <div>
            <strong className="block">Syncrox</strong>
            <p className={`text-sm ${muted} m-0 mt-0.5`}>
              {state.syncrox_running ? 'Running on :5090' : 'Stopped'}
            </p>
          </div>
          <Button
            variant={state.syncrox_running ? 'dangerSoft' : 'primary'}
            loading={sx.isPending}
            onClick={() => sx.mutate(state.syncrox_running ? 'stop' : 'start')}
          >
            {state.syncrox_running ? 'Stop' : 'Start'}
          </Button>
        </div>
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Activity className="h-4 w-4" aria-hidden /> System
          </span>
        }
        hint="Live"
      >
        <div className="grid grid-cols-2 gap-2">
          <Metric
            label="CPU"
            value={fmtPct(cpu.busy_percent)}
            detail={`Idle ${fmtPct(cpu.idle_percent)}`}
            percent={cpu.busy_percent || 0}
          />
          <Metric
            label="Memory"
            value={fmtPct(mem.used_percent)}
            detail={fmtBytes(mem.used_bytes)}
            percent={mem.used_percent || 0}
          />
          <Metric
            label="Thermal"
            value={thermal.available ? `${temp.toFixed(0)}°` : 'n/a'}
            detail={thermal.throttle_known ? (thermal.throttled ? 'Throttled' : 'OK') : 'Sensor'}
            percent={(temp / 85) * 100}
          />
          <Metric
            label="Disk"
            value={fmtPct(storage.used_percent)}
            detail={fmtBytes(storage.used_bytes)}
            percent={storage.used_percent || 0}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className={`${tile} p-3`}>
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase ${muted}`}>
              <ArrowDownToLine className="h-3 w-3" /> Down
            </span>
            <strong className="block text-base mt-1">{fmtRate(net.down_bytes_per_sec)}</strong>
          </div>
          <div className={`${tile} p-3`}>
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase ${muted}`}>
              <ArrowUpFromLine className="h-3 w-3" /> Up
            </span>
            <strong className="block text-base mt-1">{fmtRate(net.up_bytes_per_sec)}</strong>
          </div>
        </div>
      </Panel>
    </div>
  )
}
