import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Trash2,
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
import type { Service } from '@/api/types'
import { LINKED_BUCKET_KEYS, LINKED_DB_KEYS } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input, Select, TextArea } from '@/components/ui/Field/Field'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { activityMatchesService, useActivity } from '@/hooks/useActivity'
import { actionDoneLabel } from '@/lib/actions'
import { fmtRelative } from '@/lib/format'
import { codeSurface, muted, surface, tile } from '@/lib/ui'
import { isBuilding, statusLabel } from './serviceStatus'

type Tab = 'config' | 'variables' | 'console' | 'deploys'

type Props = {
  group: string
  slug: string
  siblings: Service[]
  onClose: () => void
  onDeleted: () => void
}

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
    if (deployingHere) setTab('console')
  }, [deployingHere, activity.seq])

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.service(group, slug) }),
      qc.invalidateQueries({ queryKey: queryKeys.services(group) }),
      qc.invalidateQueries({ queryKey: queryKeys.serviceEnv(group, slug) }),
    ])
  }

  const act = useMutation({
    mutationFn: (action: string) => serviceAction(group, slug, action),
    onSuccess: async (_, action) => {
      showToast(actionDoneLabel(action))
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
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'config', label: 'Config' },
    { id: 'variables', label: 'Variables' },
    { id: 'console', label: 'Console' },
    { id: 'deploys', label: 'Deploys' },
  ]

  return (
    <div className={`card ${surface} overflow-hidden`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-base-300">
        <div className="min-w-0 grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold m-0 tracking-tight">{svc.name || svc.slug}</h3>
            <span className={`badge badge-sm ${st.badge}`}>
              {building || deployingHere ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              {deployingHere && activity.progress?.label ? activity.progress.label : st.text}
            </span>
          </div>
          <p className={`text-xs font-mono m-0 ${muted}`}>
            {svc.type}
            {svc.port ? ` · :${svc.port}` : ''}
            {svc.repo ? ` · ${svc.repo}` : ''}
            {svc.branch ? `@${svc.branch}` : ''}
          </p>
          {svc.public_url || svc.url ? (
            <a
              className="link link-primary text-sm inline-flex items-center gap-1 w-fit"
              href={svc.public_url || svc.url}
              target="_blank"
              rel="noreferrer"
            >
              {svc.public_url || svc.url}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {svc.type === 'go' && !building ? (
            <>
              <Button
                variant="primary"
                icon={svc.running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                loading={act.isPending}
                onClick={() => void onAct(svc.running ? 'stop' : 'start')}
              >
                {svc.running ? 'Stop' : 'Start'}
              </Button>
              <Button
                variant="quiet"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                loading={act.isPending}
                onClick={() => void onAct('redeploy')}
              >
                Redeploy
              </Button>
            </>
          ) : null}
          <Button
            variant="dangerSoft"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            loading={del.isPending}
            onClick={() => void onDelete()}
          >
            Delete
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </header>

      {deployingHere && activity.progress ? <DeployProgress progress={activity.progress} title={activity.title} /> : null}
      {svc.last_error && !deployingHere ? (
        <p className="text-error text-sm m-0 px-4 py-2 border-b border-base-300">{svc.last_error}</p>
      ) : null}

      <div role="tablist" className="tabs tabs-bordered px-2 pt-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4">
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
          />
        ) : null}
        {tab === 'deploys' ? (
          <DeploysTab
            group={group}
            slug={slug}
            deployId={deployId}
            onSelect={setDeployId}
          />
        ) : null}
      </div>
    </div>
  )
}

function DeployProgress({
  progress,
  title,
}: {
  progress: NonNullable<import('@/api/types').Progress>
  title?: string
}) {
  const steps = progress.steps || []
  return (
    <div className="px-4 py-3 border-b border-base-300 bg-primary/5 grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{title || progress.label || 'Deploying'}</strong>
        <span className={`text-xs font-mono ${muted}`}>{progress.percent}%</span>
      </div>
      <progress className="progress progress-primary w-full h-2" value={progress.percent} max={100} />
      {progress.detail ? <p className={`text-xs m-0 ${muted}`}>{progress.detail}</p> : null}
      {steps.length ? (
        <ol className="flex flex-wrap gap-1.5 list-none m-0 p-0">
          {steps.map((s) => (
            <li
              key={s.id}
              className={`badge badge-sm ${
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
  const dbs = siblings.filter((s) => s.type === 'postgres')
  const buckets = siblings.filter((s) => s.type === 'bucket')
  const [name, setName] = useState(svc.name || '')
  const [branch, setBranch] = useState(svc.branch || '')
  const [root, setRoot] = useState(svc.root_dir || '')
  const [buildCmd, setBuildCmd] = useState(svc.build_cmd || '')
  const [memory, setMemory] = useState(String(svc.memory_mb || 512))
  const [cpus, setCpus] = useState(String(svc.cpus || 1))
  const [db, setDb] = useState(svc.linked_database || '')
  const [bucket, setBucket] = useState(svc.linked_bucket || '')
  const [autoDeploy, setAutoDeploy] = useState(!!svc.auto_deploy)

  useEffect(() => {
    setName(svc.name || '')
    setBranch(svc.branch || '')
    setRoot(svc.root_dir || '')
    setBuildCmd(svc.build_cmd || '')
    setMemory(String(svc.memory_mb || 512))
    setCpus(String(svc.cpus || 1))
    setDb(svc.linked_database || '')
    setBucket(svc.linked_bucket || '')
    setAutoDeploy(!!svc.auto_deploy)
  }, [svc])

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
        memory_mb: Number(memory) || 512,
        cpus: Number(cpus) || 1,
      }),
    onSuccess: async () => {
      showToast('Config saved')
      await onSaved()
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <form
      className="grid gap-3 max-w-xl"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <Field label="Name" htmlFor="svc-name">
        <Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      {svc.type === 'go' ? (
        <>
          <Field label="Branch" htmlFor="svc-branch">
            <Input id="svc-branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </Field>
          <Field label="Root" tip="Monorepo folder with go.mod" htmlFor="svc-root">
            <Input id="svc-root" value={root} onChange={(e) => setRoot(e.target.value)} placeholder="(repo root)" />
          </Field>
          <Field label="Build command" tip="Optional override" htmlFor="svc-build">
            <Input id="svc-build" value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} />
          </Field>
          <label className="label cursor-pointer justify-start gap-2 px-0">
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-primary"
              checked={autoDeploy}
              onChange={(e) => setAutoDeploy(e.target.checked)}
            />
            <span className="label-text text-sm">Auto-deploy on GitHub push</span>
          </label>

          <div className={`${tile} p-3 grid gap-2`}>
            <strong className="text-sm">Linked resources</strong>
            <p className={`text-xs m-0 ${muted}`}>
              Linking injects concrete env values into this service (saved on apply).
            </p>
            <Field label="Database">
              <Select value={db} onChange={(e) => setDb(e.target.value)}>
                <option value="">No database</option>
                {dbs.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {d.name || d.slug}
                  </option>
                ))}
              </Select>
            </Field>
            {db ? (
              <p className={`text-xs m-0 ${muted}`}>
                Injects: {LINKED_DB_KEYS.slice(0, 6).join(', ')}…
              </p>
            ) : null}
            <Field label="Bucket">
              <Select value={bucket} onChange={(e) => setBucket(e.target.value)}>
                <option value="">No bucket</option>
                {buckets.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {d.name || d.slug}
                  </option>
                ))}
              </Select>
            </Field>
            {bucket ? (
              <p className={`text-xs m-0 ${muted}`}>Injects: {LINKED_BUCKET_KEYS.join(', ')}</p>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Memory (MB)" htmlFor="svc-mem">
          <Input id="svc-mem" type="number" min={64} value={memory} onChange={(e) => setMemory(e.target.value)} />
        </Field>
        <Field label="CPUs" htmlFor="svc-cpu">
          <Input id="svc-cpu" type="number" min={0.1} step={0.1} value={cpus} onChange={(e) => setCpus(e.target.value)} />
        </Field>
      </div>

      {svc.connection_url ? (
        <Field label="Connection">
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
  }, [envQ.data?.env])

  const save = useMutation({
    mutationFn: () => updateServiceSettings(group, slug, { env: draft }),
    onSuccess: async () => {
      showToast('Variables saved')
      await qc.invalidateQueries({ queryKey: queryKeys.serviceEnv(group, slug) })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const linkedHint = useMemo(() => {
    const bits: string[] = []
    if (svc.linked_database) bits.push(`DB from ${svc.linked_database}`)
    if (svc.linked_bucket) bits.push(`Bucket from ${svc.linked_bucket}`)
    return bits.join(' · ')
  }, [svc.linked_database, svc.linked_bucket])

  if (envQ.isLoading) return <Spinner compact label="Loading variables…" />
  if (envQ.isError) {
    return <Empty compact title="Could not load env" body={(envQ.error as Error).message} />
  }

  return (
    <div className="grid gap-3">
      <p className={`text-sm m-0 ${muted}`}>
        One <code className="font-mono">KEY=value</code> per line.
        {linkedHint ? ` Linked values are managed automatically (${linkedHint}).` : ''}
      </p>
      <TextArea
        className="min-h-64 font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
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
}: {
  group: string
  slug: string
  running: boolean
  deploying: boolean
  activityLines: import('@/api/types').ActivityLine[]
}) {
  const logsQ = useQuery({
    queryKey: queryKeys.serviceLogs(group, slug),
    queryFn: () => fetchServiceLogs(group, slug, 250),
    refetchInterval: deploying ? false : running ? 4000 : 12_000,
    enabled: !deploying,
  })

  const text = deploying
    ? activityLines.map((l) => `[${l.level}] ${l.text}`).join('\n')
    : logsQ.data || ''

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-sm m-0 ${muted}`}>
          {deploying ? 'Live deploy output' : 'Container logs'}
        </p>
        {!deploying ? (
          <Button variant="quiet" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void logsQ.refetch()}>
            Refresh
          </Button>
        ) : null}
      </div>
      {logsQ.isLoading && !deploying ? (
        <Spinner compact label="Loading logs…" />
      ) : logsQ.isError && !deploying ? (
        <Empty
          compact
          title="Could not load logs"
          body={(logsQ.error as Error).message}
          action={
            <Button variant="quiet" onClick={() => void logsQ.refetch()}>
              Retry
            </Button>
          }
        />
      ) : !text.trim() ? (
        <Empty
          compact
          title="No output yet"
          body={deploying ? 'Waiting for deploy logs…' : 'Start the service to see logs.'}
        />
      ) : (
        <pre className={`${codeSurface} min-h-[240px] max-h-[420px]`}>{text}</pre>
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
  })

  if (listQ.isLoading) return <Spinner compact label="Loading deploys…" />
  if (listQ.isError) {
    return <Empty compact title="Could not load deploys" body={(listQ.error as Error).message} />
  }
  const items = listQ.data || []
  if (!items.length) return <Empty compact title="No deployments yet" body="Redeploy to create the first build." />

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(200px,280px)_minmax(0,1fr)]">
      <ul className="list-none m-0 p-0 grid gap-1 content-start">
        {items.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className={`w-full text-left px-3 py-2 rounded-box border transition-colors duration-300 ${
                deployId === d.id
                  ? 'border-primary bg-primary/10'
                  : 'border-base-300 hover:border-primary/40'
              }`}
              onClick={() => onSelect(d.id)}
            >
              <span className="badge badge-sm badge-ghost mr-1">{d.status}</span>
              <span className="text-sm">{d.message || d.commit?.slice(0, 7) || d.id}</span>
              <span className={`block text-xs ${muted} mt-0.5`}>{fmtRelative(d.created_at)}</span>
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
          <pre className={`${codeSurface} min-h-[240px] max-h-[420px]`}>
            {(logsQ.data || []).map((l) => `[${l.level}] ${l.text}`).join('\n') || 'No log lines.'}
          </pre>
        )}
      </div>
    </div>
  )
}
