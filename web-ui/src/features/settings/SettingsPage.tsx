import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleStop, Copy, Database, FolderGit2, HardDrive, KeyRound, Link2, Play, Route, Settings2, TriangleAlert, Unlink, type LucideIcon } from 'lucide-react'
import {
  clearGitHubToken,
  engineAction,
  fetchEngine,
  fetchGitHubSSHKey,
  fetchGitHubStatus,
  saveGitHubToken,
  updateEngine,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Disclosure } from '@/components/ui/Disclosure/Disclosure'
import { Field, Input, Select } from '@/components/ui/Field/Field'
import { Notice } from '@/components/ui/Notice/Notice'
import { Panel } from '@/components/ui/Panel/Panel'
import { PageHeader, PageSub } from '@/components/ui/PageHeader/PageHeader'
import { PanelSkeleton } from '@/components/ui/Skeleton/Skeleton'
import { SwapText } from '@/components/ui/SwapText/SwapText'
import { useToast } from '@/components/ui/Toast/Toast'
import { usePendingAddGo } from '@/features/projects/pendingAddGo'
import { DashboardExposure } from '@/features/settings/DashboardExposure'
import { DockerPanel } from '@/features/settings/DockerPanel'
import { AlertsPanel } from '@/features/settings/AlertsPanel'
import { MullvadPanel } from '@/features/settings/MullvadPanel'
import { ResidentialPanel } from '@/features/settings/ResidentialPanel'
import { sectionFrom, SettingsNav, type SettingsSection } from '@/features/settings/SettingsNav'
import { writeClipboardText } from '@/lib/clipboard'
import { codeSurface, muted } from '@/lib/ui'

/** A titled pair of related panels inside a section. */
function SettingsGroup({ title, hint, icon: Icon, children }: { title: string; hint: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="settings-group" aria-label={title}>
      <header className="settings-group-head">
        <span className="settings-group-icon"><Icon aria-hidden /></span>
        <span className="settings-group-text">
          <h2>{title}</h2>
          <small>{hint}</small>
        </span>
      </header>
      <div className="settings-pair">{children}</div>
    </section>
  )
}

export function SettingsPage() {
  const { '*': splat } = useParams()
  const navigate = useNavigate()
  const section = sectionFrom(splat)
  // The first section rides the page intro; later switches rise in on their own.
  const [switches, setSwitches] = useState({ section, count: 0 })
  if (switches.section !== section) setSwitches({ section, count: switches.count + 1 })
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const { pending, consumePending } = usePendingAddGo()
  const [token, setToken] = useState('')
  const [pgVersion, setPgVersion] = useState('')
  const [goToolchain, setGoToolchain] = useState('')

  const gh = useQuery({ queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus })
  const sshKey = useQuery({
    queryKey: queryKeys.githubSSHKey,
    queryFn: fetchGitHubSSHKey,
    enabled: !!gh.data?.connected,
  })
  const engine = useQuery({ queryKey: queryKeys.engine, queryFn: fetchEngine })

  // Fill the form when saved engine settings arrive or change (adjust during render).
  const savedEngine = engine.data?.settings
  const [seenEngine, setSeenEngine] = useState<typeof savedEngine>(undefined)
  if (savedEngine && savedEngine !== seenEngine) {
    setSeenEngine(savedEngine)
    setPgVersion(savedEngine.postgres_version || '')
    setGoToolchain(savedEngine.go_toolchain || '')
  }

  const connect = useMutation({
    mutationFn: () => saveGitHubToken(token.trim()),
    onSuccess: async () => {
      setToken('')
      showToast('GitHub connected')
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.githubStatus }),
        qc.invalidateQueries({ queryKey: queryKeys.githubSSHKey }),
      ])
      if (pending) consumePending()
    },
    onError: (e: Error) => showToast(e.message || 'GitHub failed', 'error'),
  })

  const disconnect = useMutation({
    mutationFn: clearGitHubToken,
    onSuccess: async () => {
      showToast('GitHub disconnected')
      await qc.invalidateQueries({ queryKey: queryKeys.githubStatus })
    },
    onError: (e: Error) => showToast(e.message || 'Disconnect failed', 'error'),
  })

  const engStart = useMutation({
    mutationFn: () => engineAction('start'),
    onSuccess: async () => {
      showToast('Postgres started')
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.engine }),
        qc.invalidateQueries({ queryKey: queryKeys.manage }),
      ])
    },
    onError: (e: Error) => showToast(e.message || 'Start failed', 'error'),
  })

  const engStop = useMutation({
    mutationFn: () => engineAction('stop'),
    onSuccess: async () => {
      showToast('Postgres stopped')
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.engine }),
        qc.invalidateQueries({ queryKey: queryKeys.manage }),
      ])
    },
    onError: (e: Error) => showToast(e.message || 'Stop failed', 'error'),
  })

  const engSave = useMutation({
    mutationFn: () =>
      updateEngine({
        postgres_version: pgVersion || undefined,
        go_toolchain: goToolchain || undefined,
      }),
    onSuccess: async () => {
      showToast('Engine settings saved')
      await qc.invalidateQueries({ queryKey: queryKeys.engine })
    },
    onError: (e: Error) => showToast(e.message || 'Save failed', 'error'),
  })

  async function copySSHKey() {
    const key = sshKey.data?.public_key?.trim()
    if (!key) return
    try {
      await writeClipboardText(key)
      showToast('SSH key copied')
    } catch {
      showToast('Could not copy — select the key manually', 'error')
    }
  }

  async function onDisconnect() {
    const ok = await confirm({
      title: 'Disconnect GitHub?',
      body: 'Deploying new Go apps will require connecting again. Existing services keep running.',
      confirmLabel: 'Disconnect',
      danger: true,
    })
    if (ok) disconnect.mutate()
  }

  async function onStopPostgres() {
    const ok = await confirm({
      title: 'Stop shared Postgres?',
      body: 'Linked app databases on this engine will become unreachable until you start it again.',
      confirmLabel: 'Stop',
      danger: true,
    })
    if (ok) engStop.mutate()
  }

  const engineDirty =
    !!engine.data?.settings &&
    (pgVersion !== (engine.data.settings.postgres_version || '') ||
      goToolchain !== (engine.data.settings.go_toolchain || ''))

  const pgLabel = (engine.data?.postgres_options || []).find((o) => o.id === pgVersion)?.label || pgVersion || 'Latest'
  const goLabel = (engine.data?.go_options || []).find((o) => o.id === goToolchain)?.label || goToolchain || 'From go.mod'
  const login = gh.data?.user?.login || 'GitHub'

  const githubPanel = (
          <Panel
            title={<span className="inline-flex items-center gap-1.5"><FolderGit2 aria-hidden /> GitHub</span>}
            actions={
              gh.data?.connected ? (
                <Button variant="dangerSoft" icon={<Unlink className="h-3.5 w-3.5" aria-hidden />} loading={disconnect.isPending} onClick={() => void onDisconnect()}>
                  Disconnect
                </Button>
              ) : undefined
            }
          >
            {gh.isLoading ? (
              <PanelSkeleton label="Checking GitHub" />
            ) : gh.isError ? (
              <Notice icon={TriangleAlert} tone="bad" title="Could not check GitHub" action={<Button variant="infoSoft" onClick={() => void gh.refetch()}>Retry</Button>}>
                {(gh.error as Error).message}
              </Notice>
            ) : gh.data?.connected ? (
              <>
                <div className="item-row">
                  <span className="icon-chip tone-ok"><FolderGit2 aria-hidden /></span>
                  <span className="item-text">
                    <strong>Connected as {login}</strong>
                    <span className="meta"><span>Deploys pull from your repos</span></span>
                  </span>
                </div>
                {sshKey.data?.exists && sshKey.data.public_key ? (
                  <div>
                    <Disclosure id="settings.ssh" title="SSH public key" icon={KeyRound} summary="For git over SSH">
                      <div className="grid gap-2">
                        <pre className={`${codeSurface} select-all max-h-28`} tabIndex={0}>{sshKey.data.public_key}</pre>
                        <div className="flex justify-end">
                          <Button variant="infoSoft" icon={<Copy className="h-3.5 w-3.5" aria-hidden />} onClick={() => void copySSHKey()}>
                            Copy key
                          </Button>
                        </div>
                      </div>
                    </Disclosure>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="grid gap-3">
                <p className={`text-sm ${muted} m-0`}>Connect GitHub to deploy apps from your repos.</p>
                <Field label="Personal access token" tip="Needs repo read access. Stored only on this Pi." htmlFor="settings-gh-token">
                  <Input
                    id="settings-gh-token"
                    type="password"
                    autoComplete="off"
                    placeholder="github_pat_… or ghp_…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && token.trim()) connect.mutate()
                    }}
                  />
                </Field>
                <div className="flex justify-end">
                  <Button variant="primary" icon={<FolderGit2 className="h-4 w-4" />} loading={connect.isPending} disabled={!token.trim()} onClick={() => connect.mutate()}>
                    Connect GitHub
                  </Button>
                </div>
              </div>
            )}
          </Panel>
  )
  const enginesPanel = (
        <Panel
          title={<span className="inline-flex items-center gap-1.5"><Database aria-hidden /> Engines</span>}
          busy={engine.isFetching}
        >
          {engine.isLoading ? (
            <PanelSkeleton rows={3} label="Loading engines" />
          ) : engine.isError ? (
            <Notice icon={TriangleAlert} tone="bad" title="Could not load engines" action={<Button variant="infoSoft" onClick={() => void engine.refetch()}>Retry</Button>}>
              {(engine.error as Error).message}
            </Notice>
          ) : (
            <>
              <div className="item-list">
                <div className="item-row">
                  <span className={`icon-chip ${engine.data?.postgres_running ? 'tone-ok' : 'tone-idle'}`}><Database aria-hidden /></span>
                  <span className="item-text">
                    <strong>Shared Postgres</strong>
                    <span className="meta">
                      <span><SwapText>{engine.data?.postgres_running ? 'Running' : 'Stopped'}</SwapText></span>
                      {engine.data?.postgres_image ? <span className="truncate">{engine.data.postgres_image}</span> : null}
                    </span>
                  </span>
                  {engine.data?.postgres_running ? (
                    <Button variant="dangerSoft" icon={<CircleStop className="h-3.5 w-3.5" aria-hidden />} loading={engStop.isPending} onClick={() => void onStopPostgres()}>Stop</Button>
                  ) : (
                    <Button variant="successSoft" icon={<Play className="h-3.5 w-3.5" aria-hidden />} loading={engStart.isPending} onClick={() => engStart.mutate()}>Start</Button>
                  )}
                </div>
                {engine.data?.minio_image ? (
                  <div className="item-row">
                    <span className={`icon-chip ${engine.data.minio_running ? 'tone-ok' : 'tone-idle'}`}><HardDrive aria-hidden /></span>
                    <span className="item-text">
                      <strong>MinIO storage</strong>
                      <span className="meta">
                        <span>{engine.data.minio_running ? 'Running' : 'Stopped'}</span>
                        {engine.data.minio_endpoint ? <span className="truncate">{engine.data.minio_endpoint.replace(/^https?:\/\//, '')}</span> : null}
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
              <div>
                <Disclosure id="settings.build" title="Build settings" icon={Settings2} summary={`Postgres ${pgLabel}, Go ${goLabel}`}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Postgres version" htmlFor="settings-pg-version">
                      <Select id="settings-pg-version" value={pgVersion} onChange={(e) => setPgVersion(e.target.value)}>
                        {(engine.data?.postgres_options || []).map((o) => (
                          <option key={o.id} value={o.id}>{o.label || o.id}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Go toolchain" htmlFor="settings-go-toolchain" tip={engine.data?.go_resolved_hint}>
                      <Select id="settings-go-toolchain" value={goToolchain} onChange={(e) => setGoToolchain(e.target.value)}>
                        {(engine.data?.go_options || []).map((o) => (
                          <option key={o.id} value={o.id}>{o.label || o.id}</option>
                        ))}
                      </Select>
                    </Field>
                    <div className="sm:col-span-2 flex justify-end">
                      <Button variant="primary" disabled={!engineDirty} loading={engSave.isPending} onClick={() => engSave.mutate()}>
                        Save changes
                      </Button>
                    </div>
                  </div>
                </Disclosure>
              </div>
            </>
          )}
        </Panel>
  )

  const content: Record<SettingsSection, React.ReactNode> = {
    connections: (
      <>
        <SettingsGroup title="Internet routes" hint="How Wi‑Fi traffic leaves the Pi" icon={Route}>
          <MullvadPanel />
          <ResidentialPanel />
        </SettingsGroup>
        <SettingsGroup title="Code and access" hint="Where deploys come from, and how this dashboard is reached" icon={Link2}>
          {githubPanel}
          <DashboardExposure />
        </SettingsGroup>
      </>
    ),
    alerts: <AlertsPanel />,
    system: <div className="settings-stack">{enginesPanel}<DockerPanel /></div>,
  }

  return (
    <div className="settings-page grid gap-3.5">
      <PageHeader title="Settings">
        <PageSub>Connections, alerts and the services this Pi runs</PageSub>
      </PageHeader>

      <div className="settings-shell">
        <SettingsNav current={section} onPick={(id) => navigate(`/settings/${id}`)} />
        {/* Keyed by section: each one rises in on its own when picked. */}
        <div key={section} className={`settings-section${switches.count ? ' is-switched' : ''}`}>{content[section]}</div>
      </div>
    </div>
  )
}
