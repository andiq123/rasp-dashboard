import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import styles from './OverviewPage.module.css'

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
    <div className={styles.metric}>
      <div className={styles.k}>{label}</div>
      <div className={styles.v}>{value}</div>
      <div className={styles.d}>{detail}</div>
      <div className={styles.bar}>
        <span style={{ width: `${p}%` }} />
      </div>
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
    <div className={styles.grid}>
      <Panel
        title={`${mode === 'residential' ? 'Residential' : 'Mullvad'}`}
        hint={mode === 'residential' ? 'Proxy route' : 'WireGuard route'}
      >
        <div className={styles.vpnTop}>
          <div>
            <div className={styles.big}>{mode === 'residential' ? 'Residential' : 'Mullvad'}</div>
            <div className="ghost">{mode === 'residential' ? 'SOCKS via hotspot' : 'WG via hotspot'}</div>
          </div>
          <div className={`${styles.pill} ${healthy ? '' : styles.off}`}>
            <span className={`${styles.pulse} ${healthy ? '' : styles.pulseOff}`} />
            {healthy ? 'Online' : 'Offline'}
          </div>
        </div>

        <div className={styles.seg}>
          <button
            type="button"
            className={mode === 'mullvad' ? styles.segActive : undefined}
            disabled={modeMut.isPending}
            onClick={() => modeMut.mutate('mullvad')}
          >
            Mullvad
          </button>
          <button
            type="button"
            className={mode === 'residential' ? styles.segActive : undefined}
            disabled={modeMut.isPending}
            onClick={() => modeMut.mutate('residential')}
          >
            Residential
          </button>
        </div>

        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={state.hotspot_running}
            loading={hs.isPending && hs.variables === 'start'}
            onClick={() => hs.mutate('start')}
          >
            Start
          </Button>
          <Button
            variant="dangerSoft"
            disabled={!state.hotspot_running}
            loading={hs.isPending && hs.variables === 'stop'}
            onClick={() => hs.mutate('stop')}
          >
            Stop
          </Button>
          <Button
            variant="quiet"
            loading={hs.isPending && hs.variables === 'restart'}
            onClick={() => hs.mutate('restart')}
          >
            Restart
          </Button>
        </div>

        <div className={styles.rows}>
          <div>
            <span>SSID</span>
            <strong>{state.ssid || '—'}</strong>
          </div>
          <div>
            <span>Gateway</span>
            <strong>{state.hotspot_ip || '—'}</strong>
          </div>
          <div>
            <span>DHCP</span>
            <strong>
              {state.dhcp_start && state.dhcp_end ? `${state.dhcp_start} – ${state.dhcp_end}` : 'Not set'}
            </strong>
          </div>
        </div>

        <details className={styles.settings}>
          <summary>Edit hotspot settings</summary>
          <form
            className={styles.form}
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
        </details>

        <div className={styles.syncrox}>
          <div>
            <strong>Syncrox</strong>
            <p className="ghost">{state.syncrox_running ? 'Running on :5090' : 'Stopped'}</p>
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

      <Panel title="System" hint="Live">
        <div className={styles.metrics}>
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
        <div className={styles.net}>
          <div>
            <span>Down</span>
            <strong>{fmtRate(net.down_bytes_per_sec)}</strong>
          </div>
          <div>
            <span>Up</span>
            <strong>{fmtRate(net.up_bytes_per_sec)}</strong>
          </div>
        </div>
      </Panel>
    </div>
  )
}
