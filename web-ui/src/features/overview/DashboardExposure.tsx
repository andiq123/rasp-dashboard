import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Cloud, CloudOff, Copy, ExternalLink, LockKeyhole, ShieldCheck } from 'lucide-react'
import { exposeDashboard, fetchDashboardTunnel, unexposeDashboard } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input } from '@/components/ui/Field/Field'
import { Modal } from '@/components/ui/Modal/Modal'
import { Panel } from '@/components/ui/Panel/Panel'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { useToast } from '@/components/ui/Toast/Toast'
import { muted, tile } from '@/lib/ui'

export function DashboardExposure() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'managed' | 'quick'>('managed')
  const [hostname, setHostname] = useState('')
  const [token, setToken] = useState('')
  const [accessGuarded, setAccessGuarded] = useState(false)
  const statusQ = useQuery({
    queryKey: queryKeys.dashboardTunnel,
    queryFn: fetchDashboardTunnel,
    refetchInterval: (query) => (query.state.data?.active ? 10_000 : false),
  })
  const status = statusQ.data

  useEffect(() => {
    if (status?.hostname) setHostname(status.hostname)
    if (status?.access_guarded) setAccessGuarded(true)
  }, [status?.hostname, status?.access_guarded])

  const expose = useMutation({
    mutationFn: () =>
      exposeDashboard(
        mode === 'managed'
          ? {
              mode,
              hostname: hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, ''),
              token: token.trim() || undefined,
              access_guarded: accessGuarded,
            }
          : { mode },
      ),
    onSuccess: async (next) => {
      qc.setQueryData(queryKeys.dashboardTunnel, next)
      setOpen(false)
      setToken('')
      showToast(next.verified ? 'Dashboard is live through Cloudflare' : 'Connector started — route verification is pending')
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  })
  const close = useMutation({
    mutationFn: unexposeDashboard,
    onSuccess: async (next) => {
      qc.setQueryData(queryKeys.dashboardTunnel, next)
      showToast('Dashboard exposure stopped')
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  })

  async function stopExposure() {
    const ok = await confirm({
      title: 'Stop public dashboard access?',
      body: 'The local dashboard on port 8484 stays online. Only the Cloudflare connector is stopped.',
      confirmLabel: 'Stop exposure',
      danger: true,
    })
    if (ok) close.mutate()
  }

  async function copyURL() {
    if (!status?.public_url) return
    try {
      await navigator.clipboard.writeText(status.public_url)
      showToast('Public dashboard URL copied')
    } catch {
      showToast('Could not copy the URL', 'error')
    }
  }

  const normalizedHost = hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  const savedManaged = status?.mode === 'managed'
  const managedReady = normalizedHost.includes('.') && (!!token.trim() || savedManaged) && (!!status?.auth_enabled || accessGuarded)
  const connectorTitle = !status?.active
    ? 'Local only'
    : status.connected
      ? 'Public connector connected'
      : status.state === 'starting'
        ? 'Connector starting'
        : 'Connector needs attention'
  const connectorBadge = !status?.active
    ? { text: ':8484', tone: 'badge-ghost' }
    : status.verified
      ? { text: 'Verified', tone: 'badge-success' }
      : status.connected
        ? { text: 'Route pending', tone: 'badge-warning' }
        : status.state === 'starting'
          ? { text: 'Connecting', tone: 'badge-info' }
          : { text: 'Disconnected', tone: 'badge-error' }
  const tunnelHint = status?.tunnel_id ? `Tunnel …${status.tunnel_id.slice(-4)}` : ''

  return (
    <>
      <Panel
        title={<span className="inline-flex items-center gap-1.5"><Cloud className="h-3.5 w-3.5" aria-hidden /> Remote dashboard</span>}
        hint="Cloudflare · port 8484"
        busy={statusQ.isFetching || expose.isPending || close.isPending}
      >
        {statusQ.isLoading ? (
          <Spinner compact label="Checking Cloudflare connector…" />
        ) : statusQ.isError ? (
          <Empty compact title="Could not check exposure" body={(statusQ.error as Error).message} />
        ) : (
          <div className="grid gap-2.5">
            <div className={`${tile} p-3 flex flex-wrap items-start justify-between gap-3`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <strong className="text-sm">{connectorTitle}</strong>
                  <span className={`badge badge-sm ${connectorBadge.tone}`}>
                    {connectorBadge.text}
                  </span>
                  {status?.mode === 'managed' ? <span className="badge badge-info badge-sm">Persistent</span> : null}
                  {tunnelHint ? <span className="text-[10px] font-mono text-base-content/50">{tunnelHint}</span> : null}
                </div>
                {status?.public_url ? (
                  <a href={status.public_url} target="_blank" rel="noreferrer" className="link link-primary text-xs inline-flex items-center gap-1 mt-1 max-w-full">
                    <span className="truncate">{status.public_url.replace(/^https?:\/\//, '')}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <p className={`text-xs m-0 mt-1 ${muted}`}>Available only on your LAN until you expose it.</p>
                )}
              </div>
              <div className="flex gap-1.5">
                {status?.public_url ? <Button variant="quiet" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyURL()}>Copy</Button> : null}
                {status?.active ? (
                  <Button variant="dangerSoft" icon={<CloudOff className="h-3.5 w-3.5" />} loading={close.isPending} onClick={() => void stopExposure()}>Unexpose</Button>
                ) : (
                  <Button variant="info" icon={<Cloud className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Expose dashboard</Button>
                )}
              </div>
            </div>
            {status?.active && !status.connected ? (
              <p className="text-error text-xs m-0">
                {status.state === 'misconfigured'
                  ? 'The running connector does not match the saved tunnel token. Restart exposure with the correct token.'
                  : status.last_error || 'cloudflared is running but has not registered with Cloudflare yet.'}
              </p>
            ) : status?.connected && !status.verified ? (
              <p className={`text-xs m-0 ${muted}`}>Connected securely. Public DNS and route verification will retry automatically.</p>
            ) : null}
            <div className="flex items-start gap-2 text-[11px]">
              <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" aria-hidden />
              <p className={`m-0 ${muted}`}>
                Stable mode stores the connector token owner-only and runs independently of dashboard updates. Public access must be protected by Cloudflare Access or HTTP authentication.
              </p>
            </div>
          </div>
        )}
      </Panel>

      <Modal
        open={open}
        title="Expose dashboard with Cloudflare"
        sub="Publish port 8484 with an independently managed connector."
        onClose={() => { if (!expose.isPending) setOpen(false) }}
        size="md"
        footer={<>
          <Button variant="quiet" disabled={expose.isPending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="info"
            loading={expose.isPending}
            disabled={mode === 'managed' ? !managedReady : !status?.auth_enabled}
            onClick={() => expose.mutate()}
          >
            {mode === 'managed' ? 'Expose persistently' : 'Create preview link'}
          </Button>
        </>}
      >
        <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Dashboard exposure type">
          <button type="button" role="radio" aria-checked={mode === 'managed'} className={`rounded-box border p-3 text-left ${mode === 'managed' ? 'border-info bg-info/10 ring-1 ring-info/25' : 'border-base-300'}`} onClick={() => setMode('managed')}>
            <span className="flex justify-between gap-2 text-sm font-bold">Stable hostname <span className="badge badge-info badge-sm">Recommended</span></span>
            <span className={`block text-xs mt-1 ${muted}`}>Your domain, restored after updates and reboots.</span>
          </button>
          <button type="button" role="radio" aria-checked={mode === 'quick'} disabled={!status?.auth_enabled} className={`rounded-box border p-3 text-left disabled:opacity-45 ${mode === 'quick' ? 'border-info bg-info/10 ring-1 ring-info/25' : 'border-base-300'}`} onClick={() => setMode('quick')}>
            <span className="text-sm font-bold">Temporary preview</span>
            <span className={`block text-xs mt-1 ${muted}`}>Random URL; requires FIREWIFI_AUTH.</span>
          </button>
        </div>

        {mode === 'managed' ? <>
          <div className="rounded-box border border-info/20 bg-info/5 p-3 grid gap-1.5 text-xs">
            <strong>Cloudflare setup</strong>
            <ol className={`m-0 pl-5 list-decimal grid gap-1 ${muted}`}>
              <li>Create a remotely managed tunnel in Cloudflare Zero Trust.</li>
              <li>Add a public hostname routed to <code className="font-mono text-base-content">http://127.0.0.1:8484</code>.</li>
              <li>Add a Cloudflare Access application for that hostname, then copy the connector token.</li>
            </ol>
            <a href="https://one.dash.cloudflare.com/" target="_blank" rel="noreferrer" className="link link-info inline-flex items-center gap-1 w-fit">Open Cloudflare Zero Trust <ExternalLink className="h-3 w-3" /></a>
          </div>
          <Field label="Public hostname" htmlFor="dashboard-tunnel-host" tip="HTTPS is terminated by Cloudflare.">
            <Input id="dashboard-tunnel-host" autoFocus placeholder="dashboard.example.com" value={hostname} onChange={(event) => setHostname(event.target.value)} autoCapitalize="none" spellCheck={false} />
          </Field>
          <Field label="Tunnel token" htmlFor="dashboard-tunnel-token" meta={savedManaged ? 'Optional — saved owner-only' : 'Required once'}>
            <Input id="dashboard-tunnel-token" type="password" placeholder={savedManaged ? 'Leave blank to reuse saved token' : 'eyJ…'} value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" spellCheck={false} />
          </Field>
          {!status?.auth_enabled ? (
            <label className={`${tile} p-3 flex items-start gap-2 cursor-pointer`}>
              <input type="checkbox" className="checkbox checkbox-sm checkbox-info mt-0.5" checked={accessGuarded} onChange={(event) => setAccessGuarded(event.target.checked)} />
              <span>
                <strong className="text-xs inline-flex items-center gap-1"><LockKeyhole className="h-3 w-3" /> Cloudflare Access is enabled</strong>
                <span className={`block text-[11px] mt-0.5 ${muted}`}>I added an Access policy that requires identity before traffic reaches this dashboard.</span>
              </span>
            </label>
          ) : (
            <div className="alert alert-success py-2 text-xs"><CheckCircle2 className="h-4 w-4" /> FIREWIFI_AUTH is active on this dashboard.</div>
          )}
        </> : (
          <div className="alert alert-warning text-xs"><LockKeyhole className="h-4 w-4" /> Temporary links are allowed only when FIREWIFI_AUTH protects every dashboard request.</div>
        )}
      </Modal>
    </>
  )
}
