import { useEffect, useRef } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ChartLine,
  CircleStop,
  Cpu,
  Gauge,
  HardDrive,
  ListTree,
  MemoryStick,
  Play,
  RotateCw,
  Settings2,
  Thermometer,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { fetchConfig, fetchGroups, fetchServices, hotspotAction, saveConfig, setMode } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { Service } from '@/api/types'
import { AnimatedList } from '@/components/ui/AnimatedList/AnimatedList'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber/AnimatedNumber'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Disclosure } from '@/components/ui/Disclosure/Disclosure'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input, PasswordInput } from '@/components/ui/Field/Field'
import { KeyValues, type KeyValue } from '@/components/ui/KeyValues/KeyValues'
import { Notice } from '@/components/ui/Notice/Notice'
import { Panel } from '@/components/ui/Panel/Panel'
import { Segmented } from '@/components/ui/Segmented/Segmented'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { SwapBlock, SwapText } from '@/components/ui/SwapText/SwapText'
import { StatRow } from '@/components/ui/StatRow/StatRow'
import { useToast } from '@/components/ui/Toast/Toast'
import { MonitorHistory } from '@/components/monitor/MonitorHistory'
import { useLiveState } from '@/hooks/useLiveState'
import { useSettled } from '@/hooks/useSettled'
import { actionDoneLabel } from '@/lib/actions'
import { fmtBytes, fmtPct } from '@/lib/format'
import { leakRow, MULLVAD_ACCOUNT_URL } from '@/lib/mullvad'
import { appUsage, fmtMB, hostCapacity, reservedFromServices } from '@/lib/resources'
import { MullvadTime } from './MullvadTime'
import { ResourceUsage } from './ResourceUsage'
import { computeFlow, TrafficFlow, type FlowBranch, type LinkState } from './TrafficFlow'
import { VPNRepairFlow } from './VPNRepairFlow'

type Mode = 'mullvad' | 'residential'
type HeroKind = 'checking' | 'recovering' | 'no-internet' | 'stopped' | 'online' | 'offline'

/** Brief blips (one failed probe, a stream reconnect) settle for this long before showing. */
const SETTLE_MS = 4000
type HotspotAction = 'start' | 'stop' | 'restart' | 'repair-vpn'

const modeOptions: { value: Mode; label: string }[] = [
  { value: 'mullvad', label: 'Mullvad' },
  { value: 'residential', label: 'Residential' },
]

export function OverviewPage() {
  const { state, live } = useLiveState()
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const configQ = useQuery({ queryKey: queryKeys.config, queryFn: fetchConfig })
  const groupsQ = useQuery({ queryKey: queryKeys.groups, queryFn: fetchGroups })
  const svcQueries = useQueries({
    queries: (groupsQ.data || []).map((g) => ({
      queryKey: queryKeys.services(g.slug),
      queryFn: () => fetchServices(g.slug),
      staleTime: 10_000,
    })),
  })
  const allServices: Service[] = svcQueries.flatMap((q) => q.data || [])
  const host = hostCapacity(state.device_metrics)
  const reserved = reservedFromServices(allServices)
  const used = appUsage(allServices)

  const mode: Mode = state.mode === 'residential' ? 'residential' : 'mullvad'
  const d = state.device_metrics || {}
  const cpu = d.cpu || {}
  const mem = d.memory || {}
  const thermal = d.thermal || {}
  const storage = d.storage || {}
  const temp = Number(thermal.temperature_celsius || 0)
  const vpn = state.vpn_health || {}
  const vpnRepair = mode === 'mullvad' ? state.vpn_repair : undefined
  const issues = state.issues || []
  const recoveringVPN = !!vpnRepair?.active
  const issueKey = useSettled(
    (recoveringVPN ? issues.filter((issue) => issue.action !== 'repair-vpn') : issues).map((i) => i.code).join('|'),
    SETTLE_MS,
    (key) => key === '',
  )
  const visibleIssues = issues.filter((issue) => issueKey.split('|').includes(issue.code))
  const vpnHealthy = state.vpn_health
    ? !!(vpn.country_allowed && vpn.interface_up && vpn.handshake_healthy && vpn.egress_ok)
    : !!state.wg_up
  const healthy = !!(state.hotspot_running && (mode === 'mullvad' ? vpnHealthy : state.proxy_running))
  const heroKind = useSettled<HeroKind>(
    !state.generated_at ? 'checking' : recoveringVPN ? 'recovering' : state.uplink?.checked && !state.uplink.internet ? 'no-internet' : !state.hotspot_running ? 'stopped' : healthy ? 'online' : 'offline',
    SETTLE_MS,
    (kind) => kind !== 'offline',
  )
  const showReconnecting = useSettled(!live, SETTLE_MS, (offline) => !offline)

  const modeMut = useMutation({
    mutationFn: (m: Mode) => setMode(m),
    onSuccess: async () => {
      showToast('Route switched')
      await qc.invalidateQueries({ queryKey: queryKeys.state })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const hs = useMutation({
    mutationFn: (a: HotspotAction) => hotspotAction(a),
    onSuccess: async (_, a) => {
      showToast(
        a === 'repair-vpn' ? 'VPN repair started' : `Hotspot ${actionDoneLabel(a).toLowerCase()}`,
        a === 'repair-vpn' ? 'info' : 'success',
      )
      await qc.invalidateQueries({ queryKey: queryKeys.state })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const previousRepairActive = useRef(false)
  useEffect(() => {
    if (previousRepairActive.current && !vpnRepair?.active) {
      if (vpnRepair?.phase === 'verified') showToast('Romanian Mullvad connection verified')
      if (vpnRepair?.phase === 'failed' && !vpnHealthy) showToast(vpnRepair.error || 'VPN recovery paused', 'error')
    }
    previousRepairActive.current = !!vpnRepair?.active
  }, [vpnRepair?.active, vpnRepair?.phase, vpnRepair?.error, vpnHealthy, showToast])

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

  async function onMode(next: Mode) {
    const ok = await confirm({
      title: `Switch to ${next === 'residential' ? 'Residential' : 'Mullvad'}?`,
      body: 'Connected devices may drop for a moment while the route changes.',
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
      body: a === 'stop' ? 'Connected devices lose Wi‑Fi until you start it again.' : 'Connected devices may drop for a moment.',
      confirmLabel: a === 'stop' ? 'Stop' : 'Restart',
      danger: a === 'stop',
    })
    if (ok) hs.mutate(a)
  }

  async function onRepairVPN() {
    const ok = await confirm({
      title: 'Repair Mullvad VPN?',
      body: 'Refreshes the saved relay, restarts WireGuard and verifies the Romanian exit. If the first relay has no internet, one other Romanian relay is tried. Devices may lose internet briefly.',
      confirmLabel: 'Repair VPN',
    })
    if (ok && !hs.isPending && !recoveringVPN) hs.mutate('repair-vpn')
  }

  // Breaks in the flow settle before showing; repairs show at once.
  const rawFlow = computeFlow(state, recoveringVPN, modeMut.isPending ? modeMut.variables : undefined)
  const linkKey = useSettled(rawFlow.links.join(','), SETTLE_MS, (key) => !key.includes('blocked'))
  const flow = { ...rawFlow, links: linkKey.split(',') as LinkState[] }
  const deviceCount = state.clients ?? 0
  // Apps and their public links skip the VPN (policy routing on the Pi).
  const netUsers = state.net_users || []
  const serviceName = (container: string) => allServices.find((s) => `fw-${s.group}-${s.slug}` === container)?.name || container.replace(/^fw-/, '')
  const t = state.traffic || {}
  const appUse = netUsers
    .filter((u) => u.kind === 'app')
    .map((u) => ({ name: serviceName(u.name), in: u.in_bps, out: u.out_bps, connections: u.connections }))
  const branch: FlowBranch | undefined = state.routing?.apps_direct && allServices.length
    ? {
        apps: allServices.filter((s) => (s.type === 'go' || s.type === 'redis') && s.running).length,
        links: allServices.filter((s) => s.public_url || s.tunnel_active).length,
        liveLinks: allServices.filter((s) => (s.public_url || s.tunnel_active) && (s.tunnel_connected || s.tunnel_state === 'connected')).length,
        internet: !!state.uplink?.internet,
        appUse: appUse,
        // cloudflared speaks QUIC, which has no per-socket counters: estimate it as
        // Ethernet traffic the tunnel and the apps' own connections don't explain.
        linkUse: {
          down: Math.max(0, (t.uplink_down_bps || 0) - (t.tunnel_down_bps || 0) * 1.05 - appUse.reduce((n, u) => n + u.in, 0)),
          up: Math.max(0, (t.uplink_up_bps || 0) - (t.tunnel_up_bps || 0) * 1.05 - appUse.reduce((n, u) => n + u.out, 0)),
        },
      }
    : undefined
  const devicesText = deviceCount === 1 ? '1 device' : `${deviceCount} devices`
  const c = configQ.data || {}
  const busy = modeMut.isPending || hs.isPending || save.isPending || recoveringVPN
  const actionsLocked = hs.isPending || modeMut.isPending

  const hero = heroKind === 'checking'
    ? { tone: 'idle', title: 'Checking', line: 'Reading the hotspot status from the Pi.' }
    : heroKind === 'recovering'
    ? { tone: 'busy', title: 'Recovering', line: 'Repairing the Mullvad tunnel. Internet stays blocked until Romania is verified.' }
    : heroKind === 'no-internet'
      ? { tone: 'bad', title: 'No internet', line: 'The Pi has no internet over Ethernet, so nothing can reach the Wi‑Fi. Check the cable or router.' }
    : heroKind === 'stopped'
      ? { tone: 'warn', title: 'Hotspot stopped', line: `The Pi is online. Start the hotspot to share it on ${state.ssid || 'Wi‑Fi'}.` }
      : heroKind === 'online'
        ? {
            tone: 'ok',
            title: 'Online',
            line: mode === 'mullvad'
              ? `Internet comes in over Ethernet and leaves through Mullvad in Romania${deviceCount ? ` to ${devicesText}` : ''}.`
              : `Internet comes in over Ethernet and leaves through the residential proxy${deviceCount ? ` to ${devicesText}` : ''}.`,
          }
        : {
              tone: 'bad',
              title: 'Wi‑Fi blocked',
              line: mode === 'mullvad'
                ? 'The Pi is online, but Wi‑Fi devices are held back until the Romanian tunnel is verified.'
                : 'The Pi is online, but Wi‑Fi devices are held back while the residential proxy is stopped.',
            }

  const showRepairButton =
    mode === 'mullvad' &&
    (!vpnRepair || (!recoveringVPN && (healthy || vpnRepair.phase === 'verified' || vpnRepair.phase === 'cancelled')))

  const details: KeyValue[] = [
    { label: 'Network name', value: state.ssid || '—' },
    ...(mode === 'mullvad'
      ? ([
          { label: 'Relay', value: vpn.relay || 'Unknown' },
          {
            label: 'Handshake',
            value: vpn.handshake_healthy ? `${Number(vpn.handshake_age_seconds || 0)}s ago` : 'Stale or missing',
            tone: vpn.handshake_healthy ? undefined : 'bad',
          },
          { label: 'Exit check', value: vpn.egress_ok ? 'Verified' : 'Failed', tone: vpn.egress_ok ? 'ok' : 'bad' },
          ...(leakRow(state.leak_check) ? [leakRow(state.leak_check) as KeyValue] : []),
          {
            label: 'Country rule',
            value: vpn.country_allowed ? 'Romania only' : 'Blocked: outside Romania',
            tone: vpn.country_allowed ? undefined : 'bad',
          },
        ] satisfies KeyValue[])
      : []),
  ]

  return (
    <div className="overview">

      <div className="overview-cols">
        <Panel
          className="system-panel"
          title={<span className="inline-flex items-center gap-1.5"><Activity aria-hidden /> System</span>}
          hint={showReconnecting ? 'Reconnecting…' : undefined}
        >
          <div className="system-metrics">
            <StatRow icon={Cpu} label="CPU" value={<AnimatedNumber value={cpu.busy_percent} format={fmtPct} />} percent={cpu.busy_percent || 0} />
            <StatRow
              icon={MemoryStick}
              label="Memory"
              detail={<AnimatedNumber value={mem.used_bytes} format={fmtBytes} />}
              value={<AnimatedNumber value={mem.used_percent} format={fmtPct} />}
              percent={mem.used_percent || 0}
            />
            <StatRow
              icon={Thermometer}
              label="Temperature"
              detail={thermal.throttled ? 'Throttled now' : thermal.throttled_before ? 'Throttled earlier' : undefined}
              value={thermal.available ? <AnimatedNumber value={temp} format={(v) => `${v.toFixed(0)}°`} /> : '—'}
              percent={(temp / 85) * 100}
              warnAt={76}
              badAt={94}
            />
            <StatRow
              icon={HardDrive}
              label="Disk"
              detail={<AnimatedNumber value={storage.used_bytes} format={fmtBytes} />}
              value={<AnimatedNumber value={storage.used_percent} format={fmtPct} />}
              percent={storage.used_percent || 0}
              warnAt={80}
              badAt={92}
            />
          </div>
          <div>
            <Disclosure
              id="overview.resources"
              title="App resources"
              icon={Gauge}
              summary={reserved.dedicated_services ? `${fmtMB(used.memory_mb)} used of ${fmtMB(reserved.memory_mb)} reserved` : 'No limits set'}
            >
              <ResourceUsage host={host} reserved={reserved} used={used} />
            </Disclosure>
            <Disclosure id="overview.history" title="History" icon={ChartLine} summary="CPU, memory, temperature">
              <MonitorHistory kind="system" bare />
            </Disclosure>
          </div>
        </Panel>

        <section className={`status-hero connection tone-${hero.tone}`} aria-label="Connection" aria-busy={busy || undefined}>
          <div className="status-head">
            <div className="status-title" role="status">
              <span className="dot dot-ring" aria-hidden />
              <div className="min-w-0">
                <h1><SwapText>{hero.title}</SwapText></h1>
                <SwapBlock className="status-line">{`${hero.line}${showReconnecting ? ' Reconnecting to the Pi…' : ''}`}</SwapBlock>
              </div>
            </div>
            <div className="status-actions">
              <MullvadTime account={state.mullvad_account} />
              {showRepairButton ? (
                <Button
                  variant="default"
                  icon={<Wrench className="h-3.5 w-3.5" aria-hidden />}
                  loading={hs.isPending && hs.variables === 'repair-vpn'}
                  disabled={actionsLocked || !state.hotspot_running}
                  onClick={() => void onRepairVPN()}
                  title="Refresh the relay and verify the Romanian exit"
                >
                  Repair
                </Button>
              ) : null}
              {state.hotspot_running ? (
                <>
                  <Button
                    icon={<RotateCw className="h-3.5 w-3.5" aria-hidden />}
                    loading={hs.isPending && hs.variables === 'restart'}
                    disabled={actionsLocked || recoveringVPN}
                    onClick={() => void onHotspot('restart')}
                  >
                    Restart
                  </Button>
                  <Button
                    variant="dangerSoft"
                    icon={<CircleStop className="h-3.5 w-3.5" aria-hidden />}
                    loading={hs.isPending && hs.variables === 'stop'}
                    disabled={actionsLocked}
                    onClick={() => void onHotspot('stop')}
                  >
                    Stop
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  icon={<Play className="h-3.5 w-3.5" aria-hidden />}
                  loading={hs.isPending && hs.variables === 'start'}
                  disabled={actionsLocked || recoveringVPN}
                  onClick={() => void onHotspot('start')}
                >
                  Start hotspot
                </Button>
              )}
            </div>
          </div>
          <TrafficFlow flow={flow} state={state} branch={branch} branchPending={!!state.routing?.apps_direct && (groupsQ.isLoading || svcQueries.some((q) => q.isLoading))} />

          <AnimatedList
            items={vpnRepair ? [vpnRepair] : []}
            getKey={() => 'vpn-repair'}
            render={(repair) => (
              <VPNRepairFlow
                repair={repair}
                healthy={healthy}
                loading={hs.isPending && hs.variables === 'repair-vpn'}
                disabled={actionsLocked || !state.hotspot_running}
                onRetry={() => void onRepairVPN()}
              />
            )}
          />

          <AnimatedList
            className="grid gap-2"
            items={visibleIssues}
            getKey={(issue) => issue.code}
            render={(issue) => (
              <Notice
                icon={TriangleAlert}
                tone={issue.severity === 'critical' ? 'bad' : 'warn'}
                title={issue.title}
                action={
                  issue.action === 'restart-hotspot' ? (
                    <Button
                      variant="warningSoft"
                      loading={hs.isPending && hs.variables === 'restart'}
                      disabled={actionsLocked || recoveringVPN}
                      onClick={() => void onHotspot('restart')}
                    >
                      Restart
                    </Button>
                  ) : issue.action === 'mullvad-renew' ? (
                    <a className="btn btn-sm btn-primary" href={MULLVAD_ACCOUNT_URL} target="_blank" rel="noreferrer">Add time</a>
                  ) : issue.action === 'repair-vpn' && !vpnRepair ? (
                    <Button
                      variant="dangerSoft"
                      loading={hs.isPending && hs.variables === 'repair-vpn'}
                      disabled={actionsLocked || !state.hotspot_running}
                      onClick={() => void onRepairVPN()}
                    >
                      Repair
                    </Button>
                  ) : undefined
                }
              >
                {issue.detail}
              </Notice>
            )}
          />

          <div className="connection-route">
            <Segmented
              label="Traffic route"
              options={modeOptions}
              value={mode}
              onChange={(next) => void onMode(next)}
              disabled={actionsLocked}
              pending={modeMut.isPending ? modeMut.variables : undefined}
            />
          </div>
          <div>
            <Disclosure
              id="overview.details"
              title="Connection details"
              icon={ListTree}
              summary={mode === 'mullvad' ? vpn.relay : 'Residential proxy'}
            >
              <KeyValues items={details} />
            </Disclosure>
            <Disclosure id="overview.settings" title="Hotspot settings" icon={Settings2} summary={state.ssid}>
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
                  className="grid gap-2 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    save.mutate(new FormData(e.currentTarget))
                  }}
                >
                  <Field label="Network name" tip="The Wi‑Fi name devices see.">
                    <Input name="ssid" required defaultValue={c.ssid || state.ssid || ''} />
                  </Field>
                  <Field label="Password" tip="8 to 63 characters.">
                    <PasswordInput key={c.password || ''} name="password" autoComplete="off" minLength={8} maxLength={63} defaultValue={c.password || ''} />
                  </Field>
                  <div className="sm:col-span-2 flex justify-end">
                    <Button type="submit" variant="primary" loading={save.isPending}>
                      Save settings
                    </Button>
                  </div>
                </form>
              )}
            </Disclosure>
          </div>
        </section>
      </div>

    </div>
  )
}
