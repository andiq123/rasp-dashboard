import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  Braces,
  Check,
  CircleStop,
  Copy,
  ExternalLink,
  History,
  Loader2,
  Play,
  PlugZap,
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
  fetchGroupStats,
  fetchService,
  fetchServiceEnv,
  fetchServiceLogs,
  serviceAction,
  updateServiceSettings,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { ActivityLine, ActivitySnapshot, Deployment, Progress, Service } from '@/api/types'
import { LINKED_BUCKET_KEYS, LINKED_DB_KEYS, LINKED_REDIS_KEYS } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input, Select, TextArea } from '@/components/ui/Field/Field'
import { RepoRootPicker } from '@/components/RepoRootPicker/RepoRootPicker'
import { ResourceBudget } from '@/components/ui/ResourceBudget/ResourceBudget'
import { clampCpu, clampMem, ResourceSlider } from '@/components/ui/ResourceSlider/ResourceSlider'
import { ServiceUsage } from '@/components/ui/UsageMeter/UsageMeter'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { activityMatchesService, useActivity } from '@/hooks/useActivity'
import { useLiveState } from '@/hooks/useLiveState'
import { useRealtime } from '@/hooks/realtime'
import { actionDoneLabel } from '@/lib/actions'
import { fmtRelative } from '@/lib/format'
import { hostCapacity, reservedFromServices, RESOURCE } from '@/lib/resources'
import { codeSurface, iconWell, muted, surface, tile } from '@/lib/ui'
import { LogConsole } from '@/components/ui/LogConsole/LogConsole'
import { activityToLogLines, textToLogLines, type LogLineView } from '@/lib/logLines'
import {
  isBuilding,
  isQueued,
  phaseLabel,
  serviceTypeIcon,
  statusDot,
  statusLabel,
  statusTone,
} from './serviceStatus'

type Tab = 'config' | 'integrate' | 'variables' | 'console' | 'deploys'

type Props = {
  group: string
  slug: string
  siblings: Service[]
  onClose: () => void
  onDeleted: () => void
}

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'config', label: 'Config', icon: Settings2 },
  { id: 'integrate', label: 'Integrate', icon: PlugZap },
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
  const statsQ = useQuery({
    queryKey: queryKeys.groupStats(group),
    queryFn: () => fetchGroupStats(group),
    refetchInterval: live ? false : 4000,
    staleTime: live ? 60_000 : 0,
  })
  const svc = useMemo(() => {
    const base = svcQ.data
    if (!base) return undefined
    const liveStats =
      statsQ.data?.[slug] || siblings.find((s) => s.slug === slug)?.stats || base.stats
    return liveStats ? { ...base, stats: liveStats } : base
  }, [svcQ.data, statsQ.data, siblings, slug])
  const building = svc ? isBuilding(svc) : false
  const deployingHere = activityMatchesService(activity, group, slug) && (activity.active || building)

  useEffect(() => {
    setTab('config')
    setDeployId(null)
  }, [group, slug])

  const wasDeploying = useRef(false)
  useEffect(() => {
    if (deployingHere && !wasDeploying.current) {
      setTab('deploys')
      if (activity.deployment_id) setDeployId(activity.deployment_id)
    }
    wasDeploying.current = deployingHere
  }, [deployingHere, activity.deployment_id])

  // Keep the live deployment selected while this service is building.
  useEffect(() => {
    if (!deployingHere || !activity.deployment_id) return
    setDeployId(activity.deployment_id)
  }, [deployingHere, activity.deployment_id])

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.service(group, slug) }),
      qc.invalidateQueries({ queryKey: queryKeys.services(group) }),
      qc.invalidateQueries({ queryKey: queryKeys.serviceEnv(group, slug) }),
      qc.invalidateQueries({ queryKey: queryKeys.serviceLogs(group, slug) }),
      qc.invalidateQueries({ queryKey: queryKeys.deployments(group, slug) }),
    ])
  }

  const act = useMutation({
    mutationFn: (action: string) => serviceAction(group, slug, action),
    onSuccess: async (svcRes, action) => {
      showToast(actionDoneLabel(action, svcRes?.status), action === 'redeploy' ? 'info' : 'success')
      await invalidate()
      if (action === 'redeploy') {
        setTab('deploys')
        if (svcRes?.deploy_id) setDeployId(svcRes.deploy_id)
      }
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
      body:
        svc?.type === 'redis'
          ? 'The Redis container, credentials, and persistent data volume will be permanently removed.'
          : 'Containers, deployments, and env for this service will be removed.',
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
  const waiting = queued && !busy
  const tone = statusTone(svc, { busy, waiting })
  const queuePos = (activity.queue || []).find((q) => q.group === group && q.slug === slug)?.position

  return (
    <div className={`card ${surface} overflow-hidden section-enter`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-3 sm:px-4 py-3 border-b border-base-300">
        <div className="min-w-0 flex gap-3">
          <div className={iconWell(tone)}>
            <TypeIcon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="min-w-0 grid gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold m-0 tracking-tight truncate inline-flex items-center gap-1.5 min-w-0">
                <span className={`status ${statusDot(tone)} shrink-0`} aria-hidden />
                <span className="truncate">{svc.name || svc.slug}</span>
              </h3>
              <span
                className={`badge badge-sm gap-1 ${busy ? 'badge-info' : waiting ? 'badge-warning' : st.badge}`}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                {deployingHere && activity.progress?.label
                  ? activity.progress.label
                  : waiting && queuePos
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
          {(svc.type === 'go' || svc.type === 'redis') && !building && !queued ? (
            <>
              {svc.running ? (
                <Button
                  variant="dangerSoft"
                  icon={<CircleStop className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
                  loading={act.isPending}
                  onClick={() => void onAct('stop')}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  variant="successSoft"
                  icon={<Play className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
                  loading={act.isPending}
                  onClick={() => void onAct('start')}
                >
                  Start
                </Button>
              )}
              <Button
                variant="warningSoft"
                icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
                loading={act.isPending}
                onClick={() => void onAct(svc.type === 'redis' ? 'restart' : 'redeploy')}
              >
                {svc.type === 'redis' ? 'Restart' : 'Redeploy'}
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
      {svc.running && svc.stats && !deployingHere ? (
        <div className="px-3 sm:px-4 py-2.5 border-b border-base-300 bg-base-200/40">
          <ServiceUsage
            compact
            live={live}
            stats={svc.stats}
            fallbackMem={svc.memory_mb}
            fallbackCpu={svc.cpus}
          />
        </div>
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

      <div role="tablist" aria-label="Service sections" className="flex gap-0.5 px-2 pt-2 border-b border-base-300 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          const tabId = `svc-tab-${t.id}`
          const panelId = `svc-panel-${t.id}`
          return (
            <button
              key={t.id}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              className={[
                'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-box border-b-2 -mb-px transition-colors duration-200',
                active
                  ? 'border-primary text-primary bg-primary/5'
                  : `border-transparent ${muted} hover:text-base-content hover:bg-base-200/60`,
              ].join(' ')}
              onClick={() => setTab(t.id)}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              {t.label}
              {t.id === 'deploys' && deployingHere ? (
                <span className="status status-info" title="Deploy in progress" />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="p-3 sm:p-4">
        <div
          key={tab}
          id={`svc-panel-${tab}`}
          className="tab-enter"
          role="tabpanel"
          aria-labelledby={`svc-tab-${tab}`}
        >
          {tab === 'config' ? (
            <ConfigTab svc={svc} group={group} siblings={siblings} onSaved={invalidate} />
          ) : null}
          {tab === 'integrate' ? <IntegrateTab svc={svc} siblings={siblings} /> : null}
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
            <DeploysTab
              group={group}
              slug={slug}
              deployId={deployId}
              onSelect={setDeployId}
              deploying={deployingHere}
              activity={activity}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

const POSTGRES_INSTALL = 'go get github.com/jackc/pgx/v5/pgxpool'
const POSTGRES_GO = `package data

import (
  "context"
  "os"

  "github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context) (*pgxpool.Pool, error) {
  // DATABASE_URL is injected when this database is linked to the app.
  return pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
}`

const BUCKET_INSTALL = 'go get github.com/aws/aws-sdk-go-v2/config github.com/aws/aws-sdk-go-v2/credentials github.com/aws/aws-sdk-go-v2/service/s3'
const BUCKET_GO = `package storage

import (
  "context"
  "os"

  "github.com/aws/aws-sdk-go-v2/aws"
  "github.com/aws/aws-sdk-go-v2/config"
  "github.com/aws/aws-sdk-go-v2/credentials"
  "github.com/aws/aws-sdk-go-v2/service/s3"
)

func Open(ctx context.Context) (*s3.Client, error) {
  cfg, err := config.LoadDefaultConfig(ctx,
    config.WithRegion("us-east-1"),
    config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
      os.Getenv("ACCESS_KEY_ID"), os.Getenv("SECRET_ACCESS_KEY"), "",
    )),
  )
  if err != nil { return nil, err }

  return s3.NewFromConfig(cfg, func(o *s3.Options) {
    o.BaseEndpoint = aws.String(os.Getenv("ENDPOINT"))
    o.UsePathStyle = os.Getenv("FORCE_PATH_STYLE") == "true"
  }), nil
}

// Use os.Getenv("BUCKET") for PutObject/GetObject calls.`

const REDIS_INSTALL = 'go get github.com/redis/go-redis/v9'
const REDIS_GO = `package cache

import (
  "context"
  "fmt"
  "os"
  "time"

  "github.com/redis/go-redis/v9"
)

func Open(ctx context.Context) (*redis.Client, error) {
  // REDIS_URL is injected only when this Redis service is linked.
  opts, err := redis.ParseURL(os.Getenv("REDIS_URL"))
  if err != nil { return nil, fmt.Errorf("parse REDIS_URL: %w", err) }

  client := redis.NewClient(opts)
  pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
  defer cancel()
  if err := client.Ping(pingCtx).Err(); err != nil {
    _ = client.Close()
    return nil, fmt.Errorf("connect redis: %w", err)
  }
  return client, nil
}

// Reuse this client and Close it during graceful shutdown.`

function CopyCode({ value, label = 'Copy', prominent = false }: { value: string; label?: string; prominent?: boolean }) {
  const [copied, setCopied] = useState(false)
  const { showToast } = useToast()

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      showToast('Could not copy to clipboard', 'error')
    }
  }

  return (
    <Button
      variant={prominent ? 'default' : 'quiet'}
      icon={copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      onClick={() => void copy()}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

function fencedCode(language: string, value: string): string {
  return ['```' + language, value.trim(), '```'].join('\n')
}

function appIntegrationGuide(svc: Service, siblings: Service[]): string {
  const dependencies = [
    {
      title: 'Postgres',
      slug: svc.linked_database,
      keys: LINKED_DB_KEYS,
      action: 'Select a database in the app Config tab, then save.',
    },
    {
      title: 'Redis',
      slug: svc.linked_redis,
      keys: LINKED_REDIS_KEYS,
      action: 'Select Redis in the app Config tab, then save.',
    },
    {
      title: 'Bucket storage',
      slug: svc.linked_bucket,
      keys: LINKED_BUCKET_KEYS,
      action: 'Select a bucket in the app Config tab, then save.',
    },
  ]
  const sections = dependencies.map((dependency) => {
    const linked = siblings.find((item) => item.slug === dependency.slug)
    const status = linked
      ? `Linked to **${linked.name || linked.slug}** (\`${linked.slug}\`).`
      : `Not linked. ${dependency.action}`
    return [
      `## ${dependency.title}`,
      status,
      '',
      'Runtime variables:',
      ...dependency.keys.map((key) => `- \`${key}\``),
    ].join('\n')
  })

  return [
    `# Runtime integrations for ${svc.name || svc.slug}`,
    '',
    `Group: \`${svc.group}\``,
    `Service: \`${svc.slug}\``,
    '',
    'Links are group-scoped. Credentials are injected when the container starts and must never be committed or printed in logs.',
    '',
    ...sections.flatMap((section) => [section, '']),
    '## Application checklist',
    '',
    '- Validate required variables during startup and fail with a clear message.',
    '- Reuse database pools, Redis clients, and S3 clients instead of creating one per request.',
    '- Apply context timeouts to every network operation.',
    '- Close shared clients during graceful shutdown.',
    '- Never log passwords, secret keys, or full connection URLs.',
  ].join('\n').trim()
}

function resourceIntegrationGuide({
  svc,
  resource,
  selector,
  keys,
  install,
  example,
  exampleFile,
  client,
  checklist,
}: {
  svc: Service
  resource: string
  selector: string
  keys: readonly string[]
  install: string
  example: string
  exampleFile: string
  client: string
  checklist: string
}): string {
  return [
    `# Connect ${svc.name || svc.slug} to a Go app`,
    '',
    `Group: \`${svc.group}\``,
    `Service: \`${svc.slug}\` (${resource})`,
    '',
    '## Link the service',
    '',
    `1. Open the target Go app in the same \`${svc.group}\` group.`,
    `2. Open **Config** and select **${svc.name || svc.slug}** under **${selector}**.`,
    '3. Save. A running app is recreated with scoped runtime variables.',
    '4. Read configuration from the environment; never hard-code credentials.',
    `5. Create one ${client} at startup and reuse it.`,
    '',
    '## Injected variables',
    '',
    ...keys.map((key) => `- \`${key}\``),
    '',
    'Only explicitly linked apps in this group receive these values.',
    '',
    '## Install dependency',
    '',
    fencedCode('sh', install),
    '',
    `## ${exampleFile}`,
    '',
    fencedCode('go', example),
    '',
    '## Production checklist',
    '',
    checklist,
    '',
    'Do not commit generated credentials or print secret values and full connection URLs in logs.',
  ].join('\n').trim()
}

function CodeGuide({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-box border border-base-300 overflow-hidden bg-neutral text-neutral-content">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 bg-black/10">
        <strong className="text-[11px] font-medium text-white/70">{title}</strong>
        <CopyCode value={value} />
      </div>
      <pre className="m-0 p-3 overflow-x-auto text-[11px] leading-relaxed whitespace-pre font-mono text-white/90">{value}</pre>
    </div>
  )
}

function IntegrateTab({ svc, siblings }: { svc: Service; siblings: Service[] }) {
  const isBucket = svc.type === 'bucket'
  const isRedis = svc.type === 'redis'

  if (svc.type === 'go') {
    const db = siblings.find((item) => item.slug === svc.linked_database)
    const bucket = siblings.find((item) => item.slug === svc.linked_bucket)
    const redis = siblings.find((item) => item.slug === svc.linked_redis)
    return (
      <div className="grid gap-4 max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="badge badge-primary badge-sm mb-2">Runtime integrations</span>
            <h4 className="text-base font-bold m-0">Dependencies for {svc.name || svc.slug}</h4>
            <p className={`text-xs mt-1 mb-0 ${muted}`}>
              Links stay inside this group. Credentials are injected into this container at start and never committed to the repository.
            </p>
          </div>
          <CopyCode value={appIntegrationGuide(svc, siblings)} label="Copy all instructions" prominent />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <IntegrationState
            title="Postgres"
            linked={db?.name || db?.slug}
            keys={LINKED_DB_KEYS.slice(0, 4)}
            empty="Link a database in Config to receive DATABASE_URL."
          />
          <IntegrationState
            title="Redis"
            linked={redis?.name || redis?.slug}
            keys={LINKED_REDIS_KEYS.slice(0, 4)}
            empty="Link Redis in Config to receive REDIS_URL."
          />
          <IntegrationState
            title="Bucket storage"
            linked={bucket?.name || bucket?.slug}
            keys={LINKED_BUCKET_KEYS}
            empty="Link a bucket in Config to receive S3-compatible credentials."
          />
        </div>
        <div className={`${tile} p-3 flex gap-2.5`}>
          <ShieldNote />
          <p className={`text-xs m-0 ${muted}`}>
            Read configuration once at startup, validate required values, reuse connection pools and SDK clients, and never print secrets or full connection URLs in logs.
          </p>
        </div>
      </div>
    )
  }

  const resource = isBucket ? 'bucket' : isRedis ? 'Redis service' : 'database'
  const keys = isBucket ? LINKED_BUCKET_KEYS : isRedis ? LINKED_REDIS_KEYS : LINKED_DB_KEYS
  const install = isBucket ? BUCKET_INSTALL : isRedis ? REDIS_INSTALL : POSTGRES_INSTALL
  const example = isBucket ? BUCKET_GO : isRedis ? REDIS_GO : POSTGRES_GO
  const title = isBucket ? 'Connect this bucket to a Go app' : isRedis ? 'Connect Redis to a Go app' : 'Connect this database to a Go app'
  const selector = isBucket ? 'Bucket' : isRedis ? 'Redis' : 'Database'
  const exampleFile = isBucket ? 'storage/client.go' : isRedis ? 'cache/redis.go' : 'data/postgres.go'
  const client = isBucket ? 'S3 client' : isRedis ? 'Redis client' : 'connection pool'
  const checklist = isBucket
    ? 'Set upload size limits, validate object keys, use timeouts, and keep the bucket private. Stream large objects instead of buffering them in memory.'
    : isRedis
      ? 'Use key prefixes and expirations, bound queue lengths, avoid KEYS in production, use context timeouts, and close the shared client on graceful shutdown.'
      : 'Use context timeouts, cap the pool size for this Pi, run migrations as a controlled deploy step, and close the pool on graceful shutdown.'
  const allInstructions = resourceIntegrationGuide({
    svc,
    resource,
    selector,
    keys,
    install,
    example,
    exampleFile,
    client,
    checklist,
  })

  return (
    <div className="grid gap-4 max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="badge badge-primary badge-sm mb-2">Go integration</span>
          <h4 className="text-base font-bold m-0">{title}</h4>
          <p className={`text-xs mt-1 mb-0 ${muted}`}>
            Open the app’s Config tab, select <strong>{svc.name || svc.slug}</strong> under {selector}, then save. A running app is recreated with the scoped variables.
          </p>
        </div>
        <CopyCode value={allInstructions} label="Copy all instructions" prominent />
      </div>

      <ol className="grid gap-2 list-none m-0 p-0 sm:grid-cols-3">
        {[
          ['1', 'Link', `Select this ${resource} in the Go app config.`],
          ['2', 'Read env', 'Use the injected variables—never hard-code credentials.'],
          ['3', 'Reuse client', `Create one ${client} at startup.`],
        ].map(([number, heading, body]) => (
          <li key={number} className={`${tile} p-3`}>
            <span className="badge badge-primary badge-sm mb-2">{number}</span>
            <strong className="block text-xs">{heading}</strong>
            <p className={`text-[11px] m-0 mt-1 ${muted}`}>{body}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <strong className="text-xs">Injected configuration</strong>
            <p className={`text-[11px] m-0 ${muted}`}>Available only to explicitly linked apps in this group.</p>
          </div>
          <CopyCode value={keys.join('\n')} label="Copy names" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {keys.map((key) => <span key={key} className="badge badge-ghost badge-sm font-mono">{key}</span>)}
        </div>
      </div>

      <CodeGuide title="Install dependency" value={install} />
      <CodeGuide title={exampleFile} value={example} />

      <div className="rounded-box border border-warning/25 bg-warning/5 p-3 flex gap-2.5">
        <ShieldNote />
        <div>
          <strong className="text-xs">Production checklist</strong>
          <p className={`text-[11px] m-0 mt-1 ${muted}`}>
            {checklist}
          </p>
        </div>
      </div>
    </div>
  )
}

function IntegrationState({ title, linked, keys, empty }: { title: string; linked?: string; keys: readonly string[]; empty: string }) {
  return (
    <div className={`${tile} p-3 grid gap-2`}>
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs">{title}</strong>
        <span className={`badge badge-sm ${linked ? 'badge-success' : 'badge-ghost'}`}>{linked ? 'Linked' : 'Not linked'}</span>
      </div>
      <p className={`text-[11px] m-0 ${muted}`}>{linked ? linked : empty}</p>
      {linked ? <div className="flex flex-wrap gap-1">{keys.map((key) => <span key={key} className="badge badge-ghost badge-xs font-mono">{key}</span>)}</div> : null}
    </div>
  )
}

function ShieldNote() {
  return <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary shrink-0"><PlugZap className="h-3.5 w-3.5" aria-hidden /></span>
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
  const { live } = useRealtime()
  const dbs = siblings.filter((s) => s.type === 'postgres')
  const buckets = siblings.filter((s) => s.type === 'bucket')
  const redises = siblings.filter((s) => s.type === 'redis')
  const [name, setName] = useState(svc.name || '')
  const [branch, setBranch] = useState(svc.branch || '')
  const [root, setRoot] = useState(svc.root_dir || '')
  const [buildCmd, setBuildCmd] = useState(svc.build_cmd || '')
  const [memory, setMemory] = useState(svc.memory_mb || 512)
  const [cpus, setCpus] = useState(svc.cpus || 1)
  const [db, setDb] = useState(svc.linked_database || '')
  const [bucket, setBucket] = useState(svc.linked_bucket || '')
  const [redis, setRedis] = useState(svc.linked_redis || '')
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
    setRedis(svc.linked_redis || '')
    setAutoDeploy(!!svc.auto_deploy)
  }, [svc])

  const mem = clampMem(memory)
  const cpu = clampCpu(cpus)
  const host = hostCapacity(state.device_metrics)
  const reserved = reservedFromServices(siblings, {
    excludeSlug: svc.slug,
    draft: svc.type === 'go' || svc.type === 'redis' ? { memory_mb: mem, cpus: cpu } : undefined,
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
              linked_redis: redis,
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
              Same-group database, bucket, or Redis — connection env is injected at start (see Variables).
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
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
                label="Redis"
                tip={
                  redis
                    ? `Runtime injects ${LINKED_REDIS_KEYS.slice(0, 4).join(', ')}… from ${redis}`
                    : 'Optional private cache or queue in this group.'
                }
              >
                <Select value={redis} onChange={(e) => setRedis(e.target.value)}>
                  <option value="">No Redis</option>
                  {redises.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name || item.slug}
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

      {svc.type === 'go' || svc.type === 'postgres' || svc.type === 'redis' ? (
        <div className="grid gap-3">
          {svc.running && svc.stats ? (
            <ServiceUsage
              stats={svc.stats}
              fallbackMem={svc.memory_mb}
              fallbackCpu={svc.cpus}
              live={live}
            />
          ) : null}
          {svc.type === 'go' || svc.type === 'redis' ? (
            <>
              <ResourceBudget
                host={host}
                reserved={reserved}
                draftLabel={`including this ${svc.type} service`}
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
                  liveValue={svc.running ? svc.stats?.memory_mb : null}
                  tip={svc.type === 'redis' ? 'Docker limit; Redis uses up to 75% for data and leaves headroom for overhead.' : 'Docker memory limit for this container (64–3072MB).'}
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
                  liveValue={
                    svc.running && svc.stats?.cpu_percent != null
                      ? Math.round((svc.stats.cpu_percent / 100) * 10) / 10
                      : null
                  }
                  tip="Docker CPU share for this container (0.1–4). Blue fill = live cores in use."
                />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Memory (MB)" tip="Not applied to shared Postgres engines." htmlFor="svc-mem">
                <Input
                  id="svc-mem"
                  type="number"
                  min={64}
                  value={mem}
                  onChange={(e) => setMemory(Number(e.target.value))}
                />
              </Field>
              <Field label="CPUs" tip="Not applied to shared Postgres engines." htmlFor="svc-cpu">
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
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Memory (MB)" tip="Not applied to shared bucket engines." htmlFor="svc-mem">
            <Input
              id="svc-mem"
              type="number"
              min={64}
              value={mem}
              onChange={(e) => setMemory(Number(e.target.value))}
            />
          </Field>
          <Field label="CPUs" tip="Not applied to shared bucket engines." htmlFor="svc-cpu">
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
  const isConn = kind === 'postgres' || kind === 'bucket' || kind === 'redis'

  return (
    <div className="grid gap-3 max-w-2xl">
      <Field
        label={isConn ? 'Connection variables' : 'Service variables'}
        tip={
          isConn
            ? 'Credentials for apps in this group. Each service owns its own env file.'
            : isGo
              ? 'This app’s own KEY=value pairs. Linked database, bucket, and Redis values appear below (injected at start).'
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
      ) : isGo && (svc.linked_database || svc.linked_bucket || svc.linked_redis) ? (
        <p className={`text-xs m-0 ${muted}`}>
          Linked resource has no connection env yet — open its Variables tab.
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

  const runtimeText = logsQ.data || ''

  const lines = useMemo((): LogLineView[] => {
    const out: LogLineView[] = []
    if (deploying && activityLines.length) {
      out.push({ key: 'sec-deploy', level: 'step', text: '── deploy ──' })
      out.push(...activityToLogLines(activityLines, 'dep'))
    }
    if (runtimeText.trim()) {
      if (deploying) out.push({ key: 'sec-runtime', level: 'step', text: '── runtime ──' })
      out.push(...textToLogLines(runtimeText, 'rt'))
    }
    return out
  }, [deploying, activityLines, runtimeText])

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
      ) : (
        <LogConsole
          lines={lines}
          live={deploying}
          stickKey={`${group}/${slug}`}
          className="min-h-[280px] max-h-[min(60vh,520px)]"
          empty={
            <Empty
              compact
              icon={<Terminal className="h-5 w-5" aria-hidden />}
              title="No output yet"
              body={deploying ? 'Waiting for deploy logs…' : 'Start the service to see logs.'}
            />
          }
        />
      )}
    </div>
  )
}

function deployBadge(status: string, live: boolean): { label: string; className: string } {
  if (live || status === 'building') {
    return { label: 'In progress', className: 'badge-info' }
  }
  switch (status) {
    case 'queued':
      return { label: 'Queued', className: 'badge-warning' }
    case 'active':
      return { label: 'Live', className: 'badge-success' }
    case 'failed':
      return { label: 'Failed', className: 'badge-error' }
    case 'archived':
      return { label: 'Archived', className: 'badge-ghost' }
    default:
      return { label: status || 'Deploy', className: 'badge-ghost' }
  }
}

function deployTitle(d: Deployment): string {
  if (d.commit) return d.commit.slice(0, 7)
  if (d.id) return d.id.replace(/^dpl_/, '').slice(0, 8)
  return 'Deploy'
}

function DeploysTab({
  group,
  slug,
  deployId,
  onSelect,
  deploying,
  activity,
}: {
  group: string
  slug: string
  deployId: string | null
  onSelect: (id: string | null) => void
  deploying: boolean
  activity: ActivitySnapshot
}) {
  const liveId = deploying ? activity.deployment_id || null : null

  const listQ = useQuery({
    queryKey: queryKeys.deployments(group, slug),
    queryFn: () => fetchDeployments(group, slug),
    refetchInterval: deploying ? 2000 : 8000,
  })

  const items = useMemo(() => listQ.data || [], [listQ.data])
  const selected = items.find((d) => d.id === deployId) || null
  const selectedLive =
    !!selected &&
    deploying &&
    (selected.id === liveId || selected.status === 'building' || selected.status === 'queued')

  const logsQ = useQuery({
    queryKey: queryKeys.deployLogs(group, slug, deployId || ''),
    queryFn: () => fetchDeployLogs(group, slug, deployId!),
    enabled: !!deployId && !selectedLive,
    refetchInterval: deployId && !selectedLive ? 6000 : false,
  })

  // Default selection: live → building → active → newest.
  useEffect(() => {
    if (!items.length) return
    if (liveId) {
      if (deployId !== liveId) onSelect(liveId)
      return
    }
    if (deployId && items.some((d) => d.id === deployId)) return
    const building = items.find((d) => d.status === 'building' || d.status === 'queued')
    const active = items.find((d) => d.active || d.status === 'active')
    onSelect((building || active || items[0]).id)
  }, [items, deployId, liveId, onSelect])

  const lines = useMemo((): LogLineView[] => {
    if (selectedLive) return activityToLogLines(activity.lines || [], 'live')
    return activityToLogLines(logsQ.data || [], 'store')
  }, [selectedLive, activity.lines, logsQ.data])

  if (listQ.isLoading) return <Spinner compact label="Loading deploys…" />
  if (listQ.isError) {
    return <Empty compact title="Could not load deploys" body={(listQ.error as Error).message} />
  }
  if (!items.length) {
    return (
      <Empty
        compact
        title="No deployments yet"
        body="Redeploy to start a build — live logs appear here."
      />
    )
  }

  const progress = selectedLive ? activity.progress : null

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] items-start">
      <ul className="list-none m-0 p-0 grid gap-1 content-start max-h-[min(70vh,560px)] overflow-y-auto">
        {items.map((d) => {
          const live = d.id === liveId || d.status === 'building' || d.status === 'queued'
          const badge = deployBadge(d.status, live && deploying)
          const activeSel = deployId === d.id
          return (
            <li key={d.id}>
              <button
                type="button"
                className={`w-full text-left px-2.5 py-2 rounded-box border transition-colors duration-200 ${
                  activeSel
                    ? live
                      ? 'border-info bg-info/10'
                      : 'border-primary bg-primary/10'
                    : 'border-base-300 hover:border-primary/40'
                }`}
                onClick={() => onSelect(d.id)}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`badge badge-sm gap-1 ${badge.className}`}>
                    {live && deploying ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : null}
                    {badge.label}
                  </span>
                  <span className="text-xs font-mono font-semibold">{deployTitle(d)}</span>
                </div>
                {d.message ? (
                  <span className={`block text-[11px] ${muted} mt-0.5 truncate`} title={d.message}>
                    {d.message}
                  </span>
                ) : null}
                <span className={`block text-[11px] ${muted} mt-0.5`}>
                  {fmtRelative(d.created_at)}
                  {d.branch ? ` · ${d.branch}` : ''}
                </span>
                {live && deploying && progress && activeSel ? (
                  <progress
                    className="progress progress-info w-full h-1 mt-1.5"
                    value={progress.percent || 0}
                    max={100}
                  />
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="grid gap-2 min-w-0">
        {!deployId || !selected ? (
          <Empty compact title="Select a deploy" body="View build logs for a deployment." />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <strong className="text-sm font-mono">{deployTitle(selected)}</strong>
                <p className={`text-[11px] m-0 ${muted}`}>
                  {selectedLive
                    ? progress?.label || activity.title || 'Live deploy output'
                    : selected.error
                      ? selected.error
                      : 'Stored build log'}
                  {selectedLive && activity.seq ? ' · live' : ''}
                </p>
              </div>
              {selectedLive && progress ? (
                <span className={`text-[11px] font-mono tabular-nums ${muted}`}>
                  {progress.percent}%
                </span>
              ) : null}
            </div>
            {selectedLive && progress ? (
              <progress
                className="progress progress-primary w-full h-1.5"
                value={progress.percent || 0}
                max={100}
              />
            ) : null}
            {!selectedLive && logsQ.isLoading ? (
              <Spinner compact label="Loading deploy logs…" />
            ) : !selectedLive && logsQ.isError ? (
              <Empty
                compact
                title="Could not load deploy logs"
                body={(logsQ.error as Error).message}
              />
            ) : (
              <LogConsole
                lines={lines}
                live={selectedLive}
                stickKey={deployId || ''}
                className="min-h-[280px] max-h-[min(65vh,560px)]"
                empty={
                  <Empty
                    compact
                    icon={<Terminal className="h-5 w-5" aria-hidden />}
                    title={selectedLive ? 'Waiting for build output…' : 'No log lines'}
                    body={selectedLive ? 'Logs stream here as the build runs.' : undefined}
                  />
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
