import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  Braces,
  CircleStop,
  ExternalLink,
  History,
  Loader2,
  Play,
  RotateCw,
  Settings2,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import {
  deleteService,
  fetchDeployLogs,
  fetchDeployments,
  fetchService,
  fetchServiceEnv,
  fetchServiceLogs,
  serviceAction,
  updateServiceSettings,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { ActivityLine, Progress, Service } from '@/api/types'
import { LINKED_BUCKET_KEYS, LINKED_DB_KEYS } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input, Select, TextArea } from '@/components/ui/Field/Field'
import { RepoRootPicker } from '@/components/RepoRootPicker/RepoRootPicker'
import { ResourceBudget } from '@/components/ui/ResourceBudget/ResourceBudget'
import { clampCpu, clampMem, ResourceSlider } from '@/components/ui/ResourceSlider/ResourceSlider'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { activityMatchesService, useActivity } from '@/hooks/useActivity'
import { useLiveState } from '@/hooks/useLiveState'
import { actionDoneLabel } from '@/lib/actions'
import { fmtRelative } from '@/lib/format'
import { hostCapacity, reservedFromServices, RESOURCE } from '@/lib/resources'
import { codeSurface, iconWell, muted, surface, tile } from '@/lib/ui'
import { isBuilding, isQueued, phaseLabel, serviceTypeIcon, statusLabel } from './serviceStatus'

type Tab = 'config' | 'variables' | 'console' | 'deploys'

type Props = {
  group: string
  slug: string
  siblings: Service[]
  onClose: () => void
  onDeleted: () => void
}

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'config', label: 'Config', icon: Settings2 },
  { id: 'variables', label: 'Variables', icon: Braces },
  { id: 'console', label: 'Console', icon: Terminal },
  { id: 'deploys', label: 'Deploys', icon: History },
]

export function ServiceDetail({ group, slug, siblings, onClose, onDeleted }: Props) {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const { activity, live } = useActivity()
  const [tab, setTab] = useState<Tab>('config')
  const [deployId, setDeployId] = useState<string | null>(null)

  const svcQ = useQuery({
    queryKey: queryKeys.service(group, slug),
    queryFn: () => fetchService(group, slug),
    refetchInterval: live ? 12_000 : 4000,
  })
  const svc = svcQ.data
  const building = svc ? isBuilding(svc) : false
  const deployingHere = activityMatchesService(activity, group, slug) && (activity.active || building)

  useEffect(() => {
    setTab('config')
    setDeployId(null)
  }, [group, slug])

  const wasDeploying = useRef(false)
  useEffect(() => {
    if (deployingHere && !wasDeploying.current) setTab('console')
    wasDeploying.current = deployingHere
  }, [deployingHere])

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.service(group, slug) }),
      qc.invalidateQueries({ queryKey: queryKeys.services(group) }),
      qc.invalidateQueries({ queryKey: queryKeys.serviceEnv(group, slug) }),
      qc.invalidateQueries({ queryKey: queryKeys.serviceLogs(group, slug) }),
    ])
  }

  const act = useMutation({
    mutationFn: (action: string) => serviceAction(group, slug, action),
    onSuccess: async (svcRes, action) => {
      showToast(actionDoneLabel(action, svcRes?.status), action === 'redeploy' ? 'info' : 'success')
      await invalidate()
      if (action === 'redeploy') setTab('console')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const del = useMutation({
    mutationFn: () => deleteService(group, slug),
    onSuccess: async () => {
      showToast('Service deleted')
      await qc.invalidateQueries({ queryKey: queryKeys.services(group) })
      onDeleted()
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  async function onAct(action: string) {
    if (action === 'stop' || action === 'redeploy') {
      const ok = await confirm({
        title: action === 'stop' ? `Stop ${slug}?` : `Redeploy ${slug}?`,
        body:
          action === 'stop'
            ? 'The service will stop accepting traffic.'
            : 'A new build and deploy will start.',
        confirmLabel: action === 'stop' ? 'Stop' : 'Redeploy',
        danger: action === 'stop',
      })
      if (!ok) return
    }
    act.mutate(action)
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Delete ${slug}?`,
      body: 'Containers, deployments, and env for this service will be removed.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) del.mutate()
  }

  if (svcQ.isLoading) return <Spinner compact label="Loading service…" />
  if (svcQ.isError || !svc) {
    return (
      <Empty
        compact
        title="Service not found"
        body={(svcQ.error as Error)?.message}
        action={<Button onClick={onClose}>Back</Button>}
      />
    )
  }

  const st = statusLabel(svc)
  const TypeIcon = serviceTypeIcon(svc.type)
  const publicUrl = svc.public_url || svc.url || ''
  const queued = isQueued(svc)
  const busy = building || deployingHere
  const queuePos = (activity.queue || []).find((q) => q.group === group && q.slug === slug)?.position

  return (
    <div className={`card ${surface} overflow-hidden section-enter`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-3 sm:px-4 py-3 border-b border-base-300">
        <div className="min-w-0 flex gap-3">
          <div className={iconWell(busy ? 'success' : queued ? 'warning' : svc.running ? 'success' : 'primary')}>
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <TypeIcon className="h-5 w-5" aria-hidden />
            )}
          </div>
          <div className="min-w-0 grid gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold m-0 tracking-tight truncate">{svc.name || svc.slug}</h3>
              <span
                className={`badge badge-sm ${busy ? 'badge-info' : queued ? 'badge-warning' : st.badge}`}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                {deployingHere && activity.progress?.label
                  ? activity.progress.label
                  : queued && queuePos
                    ? `Queued #${queuePos}`
                    : st.text}
              </span>
            </div>
            <p className={`text-[11px] font-mono m-0 truncate ${muted}`}>
              {svc.type}
              {svc.port ? ` · :${svc.port}` : ''}
              {svc.repo ? ` · ${svc.repo}` : ''}
              {svc.branch ? `@${svc.branch}` : ''}
            </p>
            {publicUrl ? (
              <a
                className="link link-primary text-xs inline-flex items-center gap-1 w-fit max-w-full"
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                title={publicUrl}
              >
                <span className="truncate max-w-[min(100%,28rem)]">{publicUrl.replace(/^https?:\/\//, '')}</span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {svc.type === 'go' && !building && !queued ? (
            <>
              {svc.running ? (
                <Button
                  variant="dangerSoft"
                  icon={<CircleStop className="h-3.5 w-3.5" />}
                  loading={act.isPending}
                  onClick={() => void onAct('stop')}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  variant="successSoft"
                  icon={<Play className="h-3.5 w-3.5" />}
                  loading={act.isPending}
                  onClick={() => void onAct('start')}
                >
                  Start
                </Button>
              )}
              <Button
                variant="warningSoft"
                icon={<RotateCw className="h-3.5 w-3.5" />}
                loading={act.isPending}
                onClick={() => void onAct('redeploy')}
              >
                Redeploy
              </Button>
            </>
          ) : null}
          <Button
            variant="dangerSoft"
            icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
            loading={del.isPending}
            onClick={() => void onDelete()}
            aria-label="Delete service"
          />
          <Button
            variant="quiet"
            icon={<X className="h-3.5 w-3.5" aria-hidden />}
            onClick={onClose}
            aria-label="Close"
          />
        </div>
      </header>

      {deployingHere && activity.progress ? (
        <DeployProgress progress={activity.progress} title={activity.title} />
      ) : null}
      {queued && !deployingHere ? (
        <p className="text-warning text-xs m-0 px-4 py-2 border-b border-base-300 bg-warning/5 queue-enter" role="status">
          Queued{queuePos ? ` #${queuePos}` : ''} — waiting for the active deploy to finish. One build runs at a
          time.
        </p>
      ) : null}
      {svc.last_error && !deployingHere && !queued ? (
        <p className="text-error text-xs m-0 px-4 py-2 border-b border-base-300 bg-error/5">{svc.last_error}</p>
      ) : null}

      <div role="tablist" className="flex gap-0.5 px-2 pt-2 border-b border-base-300 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={[
                'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-box border-b-2 -mb-px transition-colors duration-300',
                active
                  ? 'border-primary text-primary bg-primary/5'
                  : `border-transparent ${muted} hover:text-base-content hover:bg-base-200/60`,
              ].join(' ')}
              onClick={() => setTab(t.id)}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="p-3 sm:p-4">
        <div key={tab} className="tab-enter" role="tabpanel">
          {tab === 'config' ? (
            <ConfigTab svc={svc} group={group} siblings={siblings} onSaved={invalidate} />
          ) : null}
          {tab === 'variables' ? <VariablesTab group={group} slug={slug} svc={svc} /> : null}
          {tab === 'console' ? (
            <ConsoleTab
              group={group}
              slug={slug}
              running={!!svc.running}
              deploying={deployingHere}
              activityLines={deployingHere ? activity.lines : []}
              activitySeq={activity.seq}
            />
          ) : null}
          {tab === 'deploys' ? (
            <DeploysTab group={group} slug={slug} deployId={deployId} onSelect={setDeployId} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function DeployProgress({ progress, title }: { progress: Progress; title?: string }) {
  const steps = progress.steps || []
  const phase = phaseLabel(progress.phase)
  return (
    <div className="px-3 sm:px-4 py-2.5 border-b border-base-300 bg-info/5 grid gap-1.5 queue-enter">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <strong className="text-xs truncate">{title || progress.label || 'Deploying'}</strong>
          {phase ? <span className="badge badge-info badge-sm">{phase}</span> : null}
        </div>
        <span className={`text-[11px] font-mono ${muted}`}>{progress.percent}%</span>
      </div>
      <progress className="progress progress-primary w-full h-1.5" value={progress.percent} max={100} />
      {progress.detail ? <p className={`text-[11px] m-0 ${muted}`}>{progress.detail}</p> : null}
      {steps.length ? (
        <ol className="flex flex-wrap gap-1 list-none m-0 p-0">
          {steps.map((s) => (
            <li
              key={s.id}
              className={`badge badge-sm gap-1 transition-colors duration-300 ${
                s.status === 'done'
                  ? 'badge-success'
                  : s.status === 'active'
                    ? 'badge-info'
                    : s.status === 'error'
                      ? 'badge-error'
                      : 'badge-ghost'
              }`}
            >
              {s.status === 'active' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              {s.label}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function ConfigTab({
  svc,
  group,
  siblings,
  onSaved,
}: {
  svc: Service
  group: string
  siblings: Service[]
  onSaved: () => Promise<void>
}) {
  const { showToast } = useToast()
  const { state } = useLiveState()
  const dbs = siblings.filter((s) => s.type === 'postgres')
  const buckets = siblings.filter((s) => s.type === 'bucket')
  const [name, setName] = useState(svc.name || '')
  const [branch, setBranch] = useState(svc.branch || '')
  const [root, setRoot] = useState(svc.root_dir || '')
  const [buildCmd, setBuildCmd] = useState(svc.build_cmd || '')
  const [memory, setMemory] = useState(svc.memory_mb || 512)
  const [cpus, setCpus] = useState(svc.cpus || 1)
  const [db, setDb] = useState(svc.linked_database || '')
  const [bucket, setBucket] = useState(svc.linked_bucket || '')
  const [autoDeploy, setAutoDeploy] = useState(!!svc.auto_deploy)

  useEffect(() => {
    setName(svc.name || '')
    setBranch(svc.branch || '')
    setRoot(svc.root_dir || '')
    setBuildCmd(svc.build_cmd || '')
    setMemory(svc.memory_mb || 512)
    setCpus(svc.cpus || 1)
    setDb(svc.linked_database || '')
    setBucket(svc.linked_bucket || '')
    setAutoDeploy(!!svc.auto_deploy)
  }, [svc])

  const mem = clampMem(memory)
  const cpu = clampCpu(cpus)
  const host = hostCapacity(state.device_metrics)
  const reserved = reservedFromServices(siblings, {
    excludeSlug: svc.slug,
    draft: svc.type === 'go' ? { memory_mb: mem, cpus: cpu } : undefined,
  })

  const save = useMutation({
    mutationFn: () =>
      updateServiceSettings(group, svc.slug, {
        name: name.trim() || svc.slug,
        ...(svc.type === 'go'
          ? {
              branch: branch.trim() || 'main',
              root_dir: root.trim(),
              build_cmd: buildCmd.trim(),
              linked_database: db,
              linked_bucket: bucket,
              auto_deploy: autoDeploy,
            }
          : {}),
        memory_mb: mem,
        cpus: cpu,
      }),
    onSuccess: async () => {
      showToast('Config saved')
      await onSaved()
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <form
      className="grid gap-3 max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" tip="Display name in the board (slug stays the same)." htmlFor="svc-name">
          <Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {svc.type === 'go' ? (
          <Field
            label="Branch"
            tip="Git branch to clone on the next redeploy."
            htmlFor="svc-branch"
          >
            <Input id="svc-branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </Field>
        ) : null}
      </div>

      {svc.type === 'go' ? (
        <>
          <Field
            label="Root"
            tip="Folder that contains go.mod. Browse the repo or pick a detected module."
          >
            {svc.repo && branch ? (
              <RepoRootPicker
                repo={svc.repo}
                branch={branch.trim() || 'main'}
                value={root}
                onChange={setRoot}
              />
            ) : (
              <Input
                id="svc-root"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="(repo root)"
              />
            )}
          </Field>
          <Field
            label="Build command"
            tip="Leave blank to use the default Go build. Override for custom scripts."
            htmlFor="svc-build"
          >
            <Input id="svc-build" value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} />
          </Field>
          <label className="label cursor-pointer justify-start gap-2 px-0 py-0">
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-primary"
              checked={autoDeploy}
              onChange={(e) => setAutoDeploy(e.target.checked)}
            />
            <span className="label-text text-xs">Auto-deploy on GitHub push</span>
          </label>

          <div className={`${tile} p-2.5 grid gap-2`}>
            <strong className="text-xs">Linked resources</strong>
            <p className={`text-[11px] m-0 ${muted}`}>
              Same-group database or bucket — connection env is injected at start (see Variables).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Database"
                tip={
                  db
                    ? `Runtime injects ${LINKED_DB_KEYS.slice(0, 4).join(', ')}… from ${db}`
                    : 'Optional Postgres in this group.'
                }
              >
                <Select value={db} onChange={(e) => setDb(e.target.value)}>
                  <option value="">No database</option>
                  {dbs.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.name || d.slug}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Bucket"
                tip={
                  bucket
                    ? `Runtime injects ${LINKED_BUCKET_KEYS.slice(0, 4).join(', ')}… from ${bucket}`
                    : 'Optional object storage in this group.'
                }
              >
                <Select value={bucket} onChange={(e) => setBucket(e.target.value)}>
                  <option value="">No bucket</option>
                  {buckets.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.name || d.slug}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </>
      ) : null}

      {svc.type === 'go' ? (
        <div className="grid gap-3">
          <ResourceBudget
            host={host}
            reserved={reserved}
            draftLabel="including this service"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ResourceSlider
              id="svc-mem"
              label="Memory"
              unit="MB"
              min={RESOURCE.memMin}
              max={RESOURCE.memMax}
              step={64}
              value={mem}
              onChange={setMemory}
              meta={`${mem}MB`}
              tip="Docker memory limit for this container (64–3072MB)."
            />
            <ResourceSlider
              id="svc-cpu"
              label="CPUs"
              min={RESOURCE.cpuMin}
              max={RESOURCE.cpuMax}
              step={RESOURCE.cpuStep}
              value={cpu}
              onChange={setCpus}
              meta={`${cpu} cores`}
              tip="Docker CPU share for this container (0.1–4)."
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Memory (MB)" tip="Not applied to shared Postgres/bucket engines." htmlFor="svc-mem">
            <Input
              id="svc-mem"
              type="number"
              min={64}
              value={mem}
              onChange={(e) => setMemory(Number(e.target.value))}
            />
          </Field>
          <Field label="CPUs" tip="Not applied to shared Postgres/bucket engines." htmlFor="svc-cpu">
            <Input
              id="svc-cpu"
              type="number"
              min={0.1}
              step={0.1}
              value={cpu}
              onChange={(e) => setCpus(Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      {svc.connection_url ? (
        <Field label="Connection" tip="Ready-to-use URL for apps in this group.">
          <pre className={`${codeSurface} select-all`}>{svc.connection_url}</pre>
        </Field>
      ) : null}

      <Button type="submit" variant="primary" loading={save.isPending}>
        Save
      </Button>
    </form>
  )
}

function VariablesTab({ group, slug, svc }: { group: string; slug: string; svc: Service }) {
  const { showToast } = useToast()
  const qc = useQueryClient()
  const envQ = useQuery({
    queryKey: queryKeys.serviceEnv(group, slug),
    queryFn: () => fetchServiceEnv(group, slug),
  })
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (envQ.data?.env != null) setDraft(envQ.data.env)
  }, [envQ.data?.env, group, slug])

  const save = useMutation({
    mutationFn: () => updateServiceSettings(group, slug, { env: draft }),
    onSuccess: async () => {
      showToast('Variables saved')
      await qc.invalidateQueries({ queryKey: queryKeys.serviceEnv(group, slug) })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  if (envQ.isLoading) return <Spinner compact label="Loading variables…" />
  if (envQ.isError) {
    return <Empty compact title="Could not load env" body={(envQ.error as Error).message} />
  }

  const linked = envQ.data?.linked || []
  const kind = envQ.data?.kind || svc.type
  const isGo = kind === 'go'
  const isConn = kind === 'postgres' || kind === 'bucket'

  return (
    <div className="grid gap-3 max-w-2xl">
      <Field
        label={isConn ? 'Connection variables' : 'Service variables'}
        tip={
          isConn
            ? 'Credentials for apps in this group. Each service owns its own env file.'
            : isGo
              ? 'This app’s own KEY=value pairs. Linked database/bucket values appear below (injected at start).'
              : 'One KEY=value per line. Secrets stay on this Pi.'
        }
      >
        <TextArea
          className="min-h-48 font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          aria-label={isConn ? 'Connection variables' : 'Service variables'}
        />
      </Field>

      {linked.length ? (
        <div className="grid gap-2">
          <div>
            <strong className="text-xs">Linked (group-scoped)</strong>
            <p className={`text-[11px] m-0 mt-0.5 ${muted}`}>
              Read-only preview from siblings — applied when the container starts, not stored in this file.
            </p>
          </div>
          {linked.map((block) => (
            <Field key={`${block.kind}-${block.source}`} label={block.label || block.source}>
              <pre className={`${codeSurface} min-h-0 max-h-48 select-all`}>{block.env || '—'}</pre>
            </Field>
          ))}
        </div>
      ) : isGo && (svc.linked_database || svc.linked_bucket) ? (
        <p className={`text-xs m-0 ${muted}`}>
          Linked resource has no connection env yet — open the database/bucket Variables tab.
        </p>
      ) : null}

      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
        Save variables
      </Button>
    </div>
  )
}

function ConsoleTab({
  group,
  slug,
  running,
  deploying,
  activityLines,
  activitySeq,
}: {
  group: string
  slug: string
  running: boolean
  deploying: boolean
  activityLines: ActivityLine[]
  activitySeq: number
}) {
  const preRef = useRef<HTMLPreElement>(null)
  const stickRef = useRef(true)

  useEffect(() => {
    stickRef.current = true
  }, [group, slug])

  const logsQ = useQuery({
    queryKey: queryKeys.serviceLogs(group, slug),
    queryFn: () => fetchServiceLogs(group, slug, 400),
    refetchInterval: deploying || running ? 2000 : 8000,
    staleTime: 0,
  })

  useEffect(() => {
    if (!deploying) return
    void logsQ.refetch()
  }, [activitySeq, deploying]) // eslint-disable-line react-hooks/exhaustive-deps -- only pull runtime logs while this service is deploying

  const deployText = useMemo(
    () => activityLines.map((l) => `[${l.level}] ${l.text}`).join('\n'),
    [activityLines],
  )
  const runtimeText = logsQ.data || ''

  const text = useMemo(() => {
    if (deploying) {
      const parts: string[] = []
      if (deployText.trim()) parts.push(`── deploy ──\n${deployText}`)
      if (runtimeText.trim()) parts.push(`── runtime ──\n${runtimeText}`)
      return parts.join('\n\n')
    }
    return runtimeText
  }, [deploying, deployText, runtimeText])

  useEffect(() => {
    const el = preRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs m-0 ${muted}`}>
          {deploying
            ? 'Live deploy output + container logs for this service'
            : running
              ? 'Tailing container logs for this service'
              : 'Latest container logs (start the service for a live tail)'}
          {logsQ.isFetching ? ' · updating' : ''}
        </p>
        <Button
          variant="infoSoft"
          icon={<RotateCw className={`h-3.5 w-3.5 ${logsQ.isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => void logsQ.refetch()}
        >
          Refresh
        </Button>
      </div>
      {logsQ.isLoading && !deploying && !runtimeText ? (
        <Spinner compact label="Loading logs…" />
      ) : logsQ.isError && !deploying && !runtimeText ? (
        <Empty
          compact
          title="Could not load logs"
          body={(logsQ.error as Error).message}
          action={
            <Button variant="infoSoft" onClick={() => void logsQ.refetch()}>
              Retry
            </Button>
          }
        />
      ) : !text.trim() ? (
        <Empty
          compact
          icon={<Terminal className="h-5 w-5" aria-hidden />}
          title="No output yet"
          body={deploying ? 'Waiting for deploy logs…' : 'Start the service to see logs.'}
        />
      ) : (
        <pre
          ref={preRef}
          className={`${codeSurface} min-h-[280px] max-h-[min(60vh,520px)] ${deploying ? 'console-live' : ''}`}
          onScroll={(e) => {
            const el = e.currentTarget
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          }}
        >
          {text}
        </pre>
      )}
    </div>
  )
}

function DeploysTab({
  group,
  slug,
  deployId,
  onSelect,
}: {
  group: string
  slug: string
  deployId: string | null
  onSelect: (id: string | null) => void
}) {
  const listQ = useQuery({
    queryKey: queryKeys.deployments(group, slug),
    queryFn: () => fetchDeployments(group, slug),
    refetchInterval: 8000,
  })
  const logsQ = useQuery({
    queryKey: queryKeys.deployLogs(group, slug, deployId || ''),
    queryFn: () => fetchDeployLogs(group, slug, deployId!),
    enabled: !!deployId,
    refetchInterval: deployId ? 4000 : false,
  })

  if (listQ.isLoading) return <Spinner compact label="Loading deploys…" />
  if (listQ.isError) {
    return <Empty compact title="Could not load deploys" body={(listQ.error as Error).message} />
  }
  const items = listQ.data || []
  if (!items.length) {
    return <Empty compact title="No deployments yet" body="Redeploy to create the first build." />
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
      <ul className="list-none m-0 p-0 grid gap-1 content-start">
        {items.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className={`w-full text-left px-2.5 py-2 rounded-box border transition-colors duration-300 ${
                deployId === d.id
                  ? 'border-primary bg-primary/10'
                  : 'border-base-300 hover:border-primary/40'
              }`}
              onClick={() => onSelect(d.id)}
            >
              <span className="badge badge-sm badge-ghost mr-1">{d.status}</span>
              <span className="text-xs">{d.message || d.commit?.slice(0, 7) || d.id}</span>
              <span className={`block text-[11px] ${muted} mt-0.5`}>{fmtRelative(d.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div>
        {!deployId ? (
          <Empty compact title="Select a deploy" body="View build logs for a past deployment." />
        ) : logsQ.isLoading ? (
          <Spinner compact label="Loading deploy logs…" />
        ) : logsQ.isError ? (
          <Empty compact title="Could not load deploy logs" body={(logsQ.error as Error).message} />
        ) : (
          <pre className={`${codeSurface} min-h-[240px] max-h-[min(60vh,520px)]`}>
            {(logsQ.data || []).map((l) => `[${l.level}] ${l.text}`).join('\n') || 'No log lines.'}
          </pre>
        )}
      </div>
    </div>
  )
}
