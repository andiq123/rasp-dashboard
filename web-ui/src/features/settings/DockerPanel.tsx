import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Container,
  HardDrive,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react'
import { dockerAction, fetchManage } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { DockerContainer, DockerImage } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Empty } from '@/components/ui/Empty/Empty'
import { Panel } from '@/components/ui/Panel/Panel'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { fmtBytes } from '@/lib/format'
import { muted, tile } from '@/lib/ui'

type CtrFilter = 'all' | 'running' | 'managed'
type ImgFilter = 'all' | 'in_use' | 'dangling'

function serviceHref(group?: string, slug?: string) {
  if (!group) return '/projects'
  if (!slug) return `/projects/${encodeURIComponent(group)}`
  return `/projects/${encodeURIComponent(group)}/${encodeURIComponent(slug)}`
}

function StateDot({ running }: { running?: boolean }) {
  return (
    <span
      className={`status ${running ? 'status-success' : 'status-error'}`}
      title={running ? 'Running' : 'Stopped'}
    />
  )
}

export function DockerPanel() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const [ctrFilter, setCtrFilter] = useState<CtrFilter>('all')
  const [imgFilter, setImgFilter] = useState<ImgFilter>('all')
  const [pruneImages, setPruneImages] = useState(true)
  const [pruneContainers, setPruneContainers] = useState(true)
  const [pruneVolumes, setPruneVolumes] = useState(false)
  const [pruneCache, setPruneCache] = useState(true)
  const [pruneAllUnused, setPruneAllUnused] = useState(false)

  const manage = useQuery({
    queryKey: queryKeys.manage,
    queryFn: fetchManage,
    refetchInterval: (q) => (q.state.data?.daemon?.running ? 5000 : 15_000),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.manage })

  const act = useMutation({
    mutationFn: dockerAction,
    onSuccess: async (res) => {
      showToast(res.message || 'Done')
      await invalidate()
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const daemon = manage.data?.daemon
  const docker = manage.data?.docker
  const err = manage.data?.docker_error
  const containers = docker?.containers || []
  const images = docker?.images || []
  const volumes = docker?.volumes || []
  const disk = docker?.disk || []

  const filteredCtr = useMemo(() => {
    return containers.filter((c) => {
      if (ctrFilter === 'running') return !!c.running
      if (ctrFilter === 'managed') return !!c.managed
      return true
    })
  }, [containers, ctrFilter])

  const filteredImg = useMemo(() => {
    return images.filter((img) => {
      if (imgFilter === 'in_use') return !!img.in_use
      if (imgFilter === 'dangling') return !!img.dangling
      return true
    })
  }, [images, imgFilter])

  const runningN = containers.filter((c) => c.running).length
  const managedN = containers.filter((c) => c.managed).length

  async function onDaemonStop() {
    const ok = await confirm({
      title: 'Stop Docker daemon?',
      body: 'Every container on this Pi stops until Docker is started again.',
      confirmLabel: 'Stop daemon',
      danger: true,
    })
    if (ok) act.mutate({ action: 'daemon_stop' })
  }

  async function onRemoveContainer(c: DockerContainer) {
    const ok = await confirm({
      title: `Remove ${c.name}?`,
      body: c.managed
        ? 'This looks FireWifi-managed. Prefer Stop/Delete from Projects when possible.'
        : c.status || c.id,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (ok) act.mutate({ action: 'rm-container', id: c.id, force: true })
  }

  async function onRemoveImage(img: DockerImage) {
    const ok = await confirm({
      title: `Remove image ${img.ref}?`,
      body: img.in_use
        ? `In use by ${img.containers || img.used_by?.length || 0} container(s). Force remove only if you know they are gone.`
        : img.size || img.id,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (ok) act.mutate({ action: 'rm-image', id: img.id, force: !!img.in_use })
  }

  async function onPrune() {
    if (!pruneImages && !pruneContainers && !pruneVolumes && !pruneCache) {
      showToast('Pick at least one prune target', 'error')
      return
    }
    const bits = [
      pruneContainers && 'stopped containers',
      pruneImages && (pruneAllUnused ? 'unused images' : 'dangling images'),
      pruneVolumes && 'unused volumes',
      pruneCache && 'build cache',
    ].filter(Boolean)
    const ok = await confirm({
      title: 'Prune Docker?',
      body: `Removes: ${bits.join(', ')}. Running containers are kept.`,
      confirmLabel: 'Prune',
      danger: true,
    })
    if (ok) {
      act.mutate({
        action: 'prune',
        images: pruneImages,
        containers: pruneContainers,
        volumes: pruneVolumes,
        build_cache: pruneCache,
        all_unused: pruneAllUnused,
      })
    }
  }

  return (
    <Panel
      className="min-w-0"
      title={
        <span className="inline-flex items-center gap-2">
          <Container className="h-4 w-4" aria-hidden /> Docker
        </span>
      }
      hint={
        docker?.fetched_at
          ? `Live · ${new Date(docker.fetched_at).toLocaleTimeString()}`
          : 'Host engine'
      }
      busy={manage.isFetching || act.isPending}
    >
      {manage.isLoading ? (
        <Spinner compact label="Loading Docker…" />
      ) : manage.isError ? (
        <Empty
          compact
          title="Could not load Docker"
          body={(manage.error as Error).message}
          action={
            <Button variant="infoSoft" onClick={() => void manage.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3.5">
          {/* Daemon */}
          <div className={`${tile} px-3 py-2.5 flex flex-wrap items-center gap-2.5`}>
            <StateDot running={daemon?.running} />
            <div className="min-w-0 flex-1">
              <strong className="text-sm block leading-tight">
                Daemon {daemon?.running ? 'running' : daemon?.active || 'offline'}
              </strong>
              <p className={`text-[11px] m-0 ${muted}`}>
                {daemon?.version ? `v${daemon.version}` : 'dockerd'}
                {daemon?.enabled ? ' · enabled at boot' : ''}
                {daemon?.error ? ` · ${daemon.error}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {daemon?.running ? (
                <Button
                  variant="dangerSoft"
                  loading={act.isPending && act.variables?.action === 'daemon_stop'}
                  onClick={() => void onDaemonStop()}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  variant="successSoft"
                  loading={act.isPending && act.variables?.action === 'daemon_start'}
                  onClick={() => act.mutate({ action: 'daemon_start' })}
                >
                  Start
                </Button>
              )}
              <Button
                variant="infoSoft"
                icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => void manage.refetch()}
              >
                Refresh
              </Button>
            </div>
          </div>

          {err ? (
            <Empty compact title="Docker inventory unavailable" body={err} />
          ) : (
            <>
              {/* Disk summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(disk.length
                  ? disk.filter((d) =>
                      ['Images', 'Containers', 'Local Volumes', 'Build Cache'].includes(d.type),
                    )
                  : [
                      { type: 'Images', total_count: images.length, size: '—' },
                      { type: 'Containers', total_count: containers.length, size: '—' },
                      { type: 'Local Volumes', total_count: volumes.length, size: '—' },
                    ]
                ).map((d) => (
                  <div key={d.type} className={`${tile} px-2.5 py-2`}>
                    <div className={`text-[10px] font-bold uppercase tracking-wide ${muted}`}>
                      {d.type.replace('Local ', '')}
                    </div>
                    <div className="text-sm font-bold tabular-nums leading-tight mt-0.5">
                      {d.total_count ?? 0}
                      <span className={`ml-1.5 text-[11px] font-medium ${muted}`}>{d.size}</span>
                    </div>
                    {d.reclaimable_bytes ? (
                      <div className={`text-[10px] ${muted}`}>
                        reclaim {d.reclaimable || fmtBytes(d.reclaimable_bytes)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <p className={`text-xs m-0 ${muted}`}>
                {runningN}/{containers.length} running · {managedN} FireWifi-managed
                {docker?.reclaim_bytes ? ` · ~${fmtBytes(docker.reclaim_bytes)} reclaimable` : ''}
                {manage.data?.deploy_bytes != null
                  ? ` · deploy ${fmtBytes(manage.data.deploy_bytes)}`
                  : ''}
              </p>

              {/* Containers */}
              <section className="grid gap-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">Containers</strong>
                  <div className="join ml-auto">
                    {(['all', 'running', 'managed'] as CtrFilter[]).map((f) => (
                      <Button
                        key={f}
                        className="join-item"
                        variant={ctrFilter === f ? 'primary' : 'quiet'}
                        onClick={() => setCtrFilter(f)}
                      >
                        {f === 'all' ? 'All' : f === 'running' ? 'Running' : 'Managed'}
                      </Button>
                    ))}
                  </div>
                </div>
                {!filteredCtr.length ? (
                  <Empty compact title="No containers" body="Nothing matches this filter." />
                ) : (
                  <div className="overflow-x-auto -mx-1 px-1">
                    <table className="table table-sm w-full">
                      <thead>
                        <tr className="border-b border-base-300">
                          <th>Name</th>
                          <th>State</th>
                          <th>Image</th>
                          <th>Service</th>
                          <th className="text-right"> </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCtr.map((c) => (
                          <tr key={c.id} className="border-b border-base-300/60 last:border-0">
                            <td className="font-mono text-xs max-w-[14rem] truncate" title={c.name}>
                              {c.name}
                            </td>
                            <td>
                              <span className="inline-flex items-center gap-1.5 text-xs">
                                <StateDot running={c.running} />
                                <span className={muted}>{c.status || c.state}</span>
                              </span>
                            </td>
                            <td className={`font-mono text-[11px] max-w-[10rem] truncate ${muted}`} title={c.image}>
                              {c.image || '—'}
                            </td>
                            <td className="text-xs">
                              {c.group && c.service ? (
                                <Link
                                  className="link link-hover"
                                  to={serviceHref(c.group, c.service)}
                                >
                                  {c.group}/{c.service}
                                  {c.role ? ` · ${c.role}` : ''}
                                </Link>
                              ) : c.managed ? (
                                <span className={muted}>managed</span>
                              ) : (
                                <span className={muted}>—</span>
                              )}
                            </td>
                            <td className="text-right whitespace-nowrap">
                              <div className="inline-flex gap-1">
                                {c.running ? (
                                  <Button
                                    variant="warningSoft"
                                    icon={<Square className="h-3.5 w-3.5" aria-hidden />}
                                    aria-label={`Stop ${c.name}`}
                                    disabled={act.isPending}
                                    onClick={() => act.mutate({ action: 'stop', id: c.id })}
                                  />
                                ) : (
                                  <Button
                                    variant="successSoft"
                                    icon={<Play className="h-3.5 w-3.5" aria-hidden />}
                                    aria-label={`Start ${c.name}`}
                                    disabled={act.isPending}
                                    onClick={() => act.mutate({ action: 'start', id: c.id })}
                                  />
                                )}
                                <Button
                                  variant="dangerSoft"
                                  icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                                  aria-label={`Remove ${c.name}`}
                                  disabled={act.isPending}
                                  onClick={() => void onRemoveContainer(c)}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Images */}
              <section className="grid gap-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm inline-flex items-center gap-1.5">
                    <Box className="h-3.5 w-3.5" aria-hidden /> Images
                  </strong>
                  <div className="join ml-auto">
                    {(['all', 'in_use', 'dangling'] as ImgFilter[]).map((f) => (
                      <Button
                        key={f}
                        className="join-item"
                        variant={imgFilter === f ? 'primary' : 'quiet'}
                        onClick={() => setImgFilter(f)}
                      >
                        {f === 'all' ? 'All' : f === 'in_use' ? 'In use' : 'Dangling'}
                      </Button>
                    ))}
                  </div>
                </div>
                {!filteredImg.length ? (
                  <Empty compact title="No images" body="Nothing matches this filter." />
                ) : (
                  <div className="overflow-x-auto -mx-1 px-1">
                    <table className="table table-sm w-full">
                      <thead>
                        <tr className="border-b border-base-300">
                          <th>Ref</th>
                          <th>Size</th>
                          <th>Used by</th>
                          <th className="text-right"> </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredImg.map((img) => (
                          <tr key={img.id} className="border-b border-base-300/60 last:border-0">
                            <td className="min-w-0">
                              <div className="font-mono text-xs truncate max-w-[18rem]" title={img.ref}>
                                {img.ref}
                              </div>
                              {img.dangling ? (
                                <span className={`text-[10px] ${muted}`}>dangling</span>
                              ) : null}
                            </td>
                            <td className={`text-xs tabular-nums ${muted}`}>{img.size || '—'}</td>
                            <td className="text-xs max-w-[16rem]">
                              {img.services?.length ? (
                                <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                                  {img.services.map((s) => {
                                    const [g, slug] = s.split('/')
                                    return (
                                      <Link key={s} className="link link-hover" to={serviceHref(g, slug)}>
                                        {s}
                                      </Link>
                                    )
                                  })}
                                  <span className={muted}>· {img.containers} ctr</span>
                                </span>
                              ) : img.used_by?.length ? (
                                <span className={`${muted} font-mono text-[11px] truncate block`} title={img.used_by.join(', ')}>
                                  {img.used_by.slice(0, 2).join(', ')}
                                  {img.used_by.length > 2 ? ` +${img.used_by.length - 2}` : ''}
                                </span>
                              ) : (
                                <span className={muted}>unused</span>
                              )}
                            </td>
                            <td className="text-right">
                              <Button
                                variant="dangerSoft"
                                icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                                aria-label={`Remove ${img.ref}`}
                                disabled={act.isPending}
                                onClick={() => void onRemoveImage(img)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Volumes + prune */}
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.85fr)] items-start">
                <section className="grid gap-1.5 min-w-0">
                  <strong className="text-sm inline-flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" aria-hidden /> Volumes
                  </strong>
                  {!volumes.length ? (
                    <Empty compact title="No volumes" />
                  ) : (
                    <div className="overflow-x-auto -mx-1 px-1 max-h-48 overflow-y-auto">
                      <table className="table table-sm w-full">
                        <thead>
                          <tr className="border-b border-base-300">
                            <th>Name</th>
                            <th>Size</th>
                            <th>Use</th>
                          </tr>
                        </thead>
                        <tbody>
                          {volumes.map((v) => (
                            <tr key={v.name} className="border-b border-base-300/60 last:border-0">
                              <td className="font-mono text-[11px] max-w-[14rem] truncate" title={v.name}>
                                {v.name}
                              </td>
                              <td className={`text-xs tabular-nums ${muted}`}>{v.size || '—'}</td>
                              <td className={`text-xs ${muted}`}>{v.in_use ? 'in use' : 'free'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className={`${tile} p-3 grid gap-2`}>
                  <strong className="text-sm">Prune</strong>
                  <p className={`text-[11px] m-0 ${muted}`}>
                    Safe cleanup — running containers stay. Confirm before run.
                  </p>
                  <label className="label cursor-pointer justify-start gap-2 py-0">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={pruneContainers}
                      onChange={(e) => setPruneContainers(e.target.checked)}
                    />
                    <span className="label-text text-xs">Stopped containers</span>
                  </label>
                  <label className="label cursor-pointer justify-start gap-2 py-0">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={pruneImages}
                      onChange={(e) => setPruneImages(e.target.checked)}
                    />
                    <span className="label-text text-xs">Images</span>
                  </label>
                  <label className="label cursor-pointer justify-start gap-2 py-0 pl-6">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={pruneAllUnused}
                      disabled={!pruneImages}
                      onChange={(e) => setPruneAllUnused(e.target.checked)}
                    />
                    <span className={`label-text text-xs ${muted}`}>All unused (not just dangling)</span>
                  </label>
                  <label className="label cursor-pointer justify-start gap-2 py-0">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={pruneVolumes}
                      onChange={(e) => setPruneVolumes(e.target.checked)}
                    />
                    <span className="label-text text-xs">Unused volumes</span>
                  </label>
                  <label className="label cursor-pointer justify-start gap-2 py-0">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={pruneCache}
                      onChange={(e) => setPruneCache(e.target.checked)}
                    />
                    <span className="label-text text-xs">Build cache</span>
                  </label>
                  <Button
                    variant="warningSoft"
                    className="mt-1"
                    loading={act.isPending && act.variables?.action === 'prune'}
                    onClick={() => void onPrune()}
                  >
                    Prune selected
                  </Button>
                </section>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  )
}
