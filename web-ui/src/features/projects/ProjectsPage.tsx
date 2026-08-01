import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowLeft,
  Box,
  Database,
  Folder,
  FolderGit2,
  Layers3,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  createBucket,
  createGroup,
  createPostgres,
  deleteGroup,
  deployGo,
  fetchBranches,
  fetchGitHubStatus,
  fetchGroups,
  fetchGroupStats,
  fetchPorts,
  fetchRepos,
  fetchServices,
  renameGroup,
  serviceAction,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { LINKED_BUCKET_KEYS, LINKED_DB_KEYS } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { Choice } from '@/components/ui/Choice/Choice'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input, Select, TextArea } from '@/components/ui/Field/Field'
import { Modal } from '@/components/ui/Modal/Modal'
import { RepoRootPicker } from '@/components/RepoRootPicker/RepoRootPicker'
import { ResourceBudget } from '@/components/ui/ResourceBudget/ResourceBudget'
import { clampCpu, clampMem, ResourceSlider } from '@/components/ui/ResourceSlider/ResourceSlider'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { actionDoneLabel } from '@/lib/actions'
import { fmtBytes, slugify } from '@/lib/format'
import { hostCapacity, reservedFromServices, RESOURCE } from '@/lib/resources'
import { muted, surface, tile } from '@/lib/ui'
import { usePendingAddGo } from './pendingAddGo'
import { ServiceCard } from './ServiceCard'
import { ServiceDetail } from './ServiceDetail'
import { DeployQueue } from './DeployQueue'
import {
  isBuilding,
  isQueued,
  phaseLabel,
  serviceTypeIcon,
  statusDot,
  statusLabel,
  statusTone,
} from './serviceStatus'
import { activityMatchesGroup, useActivity } from '@/hooks/useActivity'
import { useLiveState } from '@/hooks/useLiveState'

type WizardStep = 'type' | 'github' | 'group' | 'go' | 'postgres' | 'bucket' | null

export function ProjectsPage() {
  const { '*': splat } = useParams()
  const parts = (splat || '').split('/').filter(Boolean)
  const groupSlug = parts[0] || ''
  const serviceSlug = parts[1] || ''
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const { setPending } = usePendingAddGo()
  const { activity, live } = useActivity()
  const { state } = useLiveState()

  const [wizard, setWizard] = useState<WizardStep>(null)
  const [groupName, setGroupName] = useState('')
  const [draftName, setDraftName] = useState('')
  const [goForm, setGoForm] = useState({
    repo: '',
    branch: '',
    root_dir: '',
    linked_database: '',
    linked_bucket: '',
    env: '',
    memory_mb: 512,
    cpus: 1,
    build_cmd: '',
  })
  const [pgName, setPgName] = useState('')
  const [bucketName, setBucketName] = useState('')

  const groupsQ = useQuery({
    queryKey: queryKeys.groups,
    queryFn: fetchGroups,
    refetchInterval: live ? 30_000 : 12_000,
  })
  const servicesQ = useQuery({
    queryKey: queryKeys.services(groupSlug),
    queryFn: () => fetchServices(groupSlug),
    enabled: !!groupSlug,
    refetchInterval: live ? 15_000 : 5_000,
  })
  const statsQ = useQuery({
    queryKey: queryKeys.groupStats(groupSlug),
    queryFn: () => fetchGroupStats(groupSlug),
    enabled: !!groupSlug,
    // SSE pushes stats when live; poll only as fallback.
    refetchInterval: live ? false : 4000,
    staleTime: live ? 60_000 : 0,
  })
  const ghQ = useQuery({ queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus })

  const group = (groupsQ.data || []).find((g) => g.slug === groupSlug)
  const services = useMemo(() => {
    const list = servicesQ.data || []
    const stats = statsQ.data || {}
    return list.map((s) => {
      const liveStats = stats[s.slug]
      return liveStats ? { ...s, stats: liveStats } : s
    })
  }, [servicesQ.data, statsQ.data])
  const selected = services.find((s) => s.slug === serviceSlug)
  const buildingN = services.filter(isBuilding).length
  const queuedN = services.filter(isQueued).length
  const liveDeploying = activity.active && activityMatchesGroup(activity, groupSlug)
  const deployingN = Math.max(buildingN + queuedN, liveDeploying ? 1 : 0, (activity.queue || []).length)

  useEffect(() => {
    if (group) setDraftName(group.name || group.slug)
  }, [group])

  useEffect(() => {
    if (search.get('wizard') === 'go' && groupSlug) {
      setWizard('go')
      const next = new URLSearchParams(search)
      next.delete('wizard')
      setSearch(next, { replace: true })
    }
  }, [search, groupSlug, setSearch])

  const reposQ = useQuery({
    queryKey: queryKeys.githubRepos,
    queryFn: fetchRepos,
    enabled: wizard === 'go' && !!ghQ.data?.connected,
  })
  const branchesQ = useQuery({
    queryKey: queryKeys.githubBranches(goForm.repo),
    queryFn: () => fetchBranches(goForm.repo),
    enabled: wizard === 'go' && !!goForm.repo,
  })
  const portsQ = useQuery({
    queryKey: queryKeys.ports,
    queryFn: fetchPorts,
    enabled: wizard === 'go',
  })

  useEffect(() => {
    if (!goForm.repo || !branchesQ.data?.length) return
    const def = branchesQ.data.find((b) => b.default) || branchesQ.data[0]
    if (def && !goForm.branch) setGoForm((f) => ({ ...f, branch: def.name }))
  }, [goForm.repo, goForm.branch, branchesQ.data])

  const createGroupMut = useMutation({
    mutationFn: () => createGroup(groupName.trim()),
    onSuccess: async (g) => {
      showToast('Group created')
      setWizard(null)
      setGroupName('')
      await qc.invalidateQueries({ queryKey: queryKeys.groups })
      navigate(`/projects/${encodeURIComponent(g.slug)}`)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const renameMut = useMutation({
    mutationFn: () => renameGroup(groupSlug, draftName.trim()),
    onSuccess: async () => {
      showToast('Group renamed')
      await qc.invalidateQueries({ queryKey: queryKeys.groups })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const deleteGroupMut = useMutation({
    mutationFn: () => deleteGroup(groupSlug),
    onSuccess: async () => {
      showToast('Group deleted')
      await qc.invalidateQueries({ queryKey: queryKeys.groups })
      navigate('/projects')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const deployMut = useMutation({
    mutationFn: () => {
      const name = goForm.repo.split('/')[1] || 'app'
      return deployGo(groupSlug, {
        type: 'go',
        repo: goForm.repo,
        branch: goForm.branch || 'main',
        name,
        linked_database: goForm.linked_database,
        linked_bucket: goForm.linked_bucket,
        root_dir: goForm.root_dir,
        memory_mb: goForm.memory_mb,
        cpus: goForm.cpus,
        build_cmd: goForm.build_cmd,
        go_toolchain: 'auto',
        env: goForm.env,
      })
    },
    onSuccess: async (svc) => {
      showToast(svc.status === 'queued' ? 'Queued — waiting for build slot' : 'Deploy started', 'info')
      setWizard(null)
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
    },
    onError: (e: Error) => showToast(e.message || 'Deploy failed', 'error'),
  })

  const pgMut = useMutation({
    mutationFn: () => createPostgres(groupSlug, { type: 'postgres', name: pgName.trim(), version: 'latest' }),
    onSuccess: async (svc) => {
      showToast('Postgres creating…', 'info')
      setWizard(null)
      setPgName('')
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
      navigate(`/projects/${encodeURIComponent(groupSlug)}/${encodeURIComponent(svc.slug)}`)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const bucketMut = useMutation({
    mutationFn: () => createBucket(groupSlug, { type: 'bucket', name: bucketName.trim() }),
    onSuccess: async (svc) => {
      showToast('Bucket creating…', 'info')
      setWizard(null)
      setBucketName('')
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
      navigate(`/projects/${encodeURIComponent(groupSlug)}/${encodeURIComponent(svc.slug)}`)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const svcAct = useMutation({
    mutationFn: ({ slug, action }: { slug: string; action: string }) =>
      serviceAction(groupSlug, slug, action),
    onSuccess: async (svc, v) => {
      showToast(
        actionDoneLabel(v.action, svc?.status),
        v.action === 'redeploy' ? 'info' : 'success',
      )
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  async function onDeleteGroup() {
    const ok = await confirm({
      title: `Delete group ${groupSlug}?`,
      body: 'All services in this group will be removed.',
      confirmLabel: 'Delete group',
      danger: true,
    })
    if (ok) deleteGroupMut.mutate()
  }

  async function onServiceAction(slug: string, action: string) {
    if (action === 'stop' || action === 'redeploy') {
      const ok = await confirm({
        title: action === 'stop' ? `Stop ${slug}?` : `Redeploy ${slug}?`,
        body: action === 'stop' ? 'The service will stop accepting traffic.' : 'A new build and deploy will start.',
        confirmLabel: action === 'stop' ? 'Stop' : 'Redeploy',
        danger: action === 'stop',
      })
      if (!ok) return
    }
    svcAct.mutate({ slug, action })
  }

  const dbs = services.filter((s) => s.type === 'postgres')
  const buckets = services.filter((s) => s.type === 'bucket')

  function openAddService() {
    if (!groupSlug) {
      setWizard('group')
      return
    }
    setWizard('type')
  }

  function pickGo() {
    if (!ghQ.data?.connected) {
      setWizard('github')
      return
    }
    setGoForm({
      repo: '',
      branch: '',
      root_dir: '',
      linked_database: dbs.length === 1 ? dbs[0].slug : '',
      linked_bucket: buckets.length === 1 ? buckets[0].slug : '',
      env: '',
      memory_mb: 512,
      cpus: 1,
      build_cmd: '',
    })
    setWizard('go')
  }

  const nameDirty = group && draftName.trim() !== (group.name || group.slug).trim()

  return (
    <div className="min-h-[calc(100vh-100px)]">
      <div className="grid grid-cols-1 gap-3.5 items-start min-h-[60vh] md:grid-cols-[minmax(200px,260px)_minmax(0,1fr)]">
        <aside className={`card ${surface} section-enter`}>
          <div className="card-body gap-3 p-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold m-0">Groups</h3>
              <span className={`text-xs font-semibold ${muted}`}>{(groupsQ.data || []).length}</span>
              <Button
                variant="primary"
                className="ml-auto"
                icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => setWizard('group')}
              >
                New
              </Button>
            </div>
            {groupsQ.isLoading ? (
              <Spinner compact label="Loading groups…" />
            ) : groupsQ.isError ? (
              <Empty compact title="Could not load groups" body={(groupsQ.error as Error).message} />
            ) : !(groupsQ.data || []).length ? (
              <Empty compact title="No groups yet" body="Create a group to deploy apps and databases." />
            ) : (
              <nav className="menu menu-sm gap-1 p-0" aria-label="Groups">
                {(groupsQ.data || []).map((g) => (
                  <li key={g.slug}>
                    <Link
                      to={`/projects/${encodeURIComponent(g.slug)}`}
                      className={
                        g.slug === groupSlug
                          ? 'active bg-primary/15 text-primary border border-primary/30 transition-colors duration-200'
                          : 'border border-transparent transition-colors duration-200'
                      }
                    >
                      <Folder className={`h-4 w-4 shrink-0 ${muted}`} aria-hidden />
                      <span className="min-w-0">
                        <strong className="block truncate">{g.name || g.slug}</strong>
                        <span className={`block font-mono text-[11px] ${muted} font-normal`}>
                          {g.slug}
                          {g.service_count != null ? ` · ${g.service_count}` : ''}
                          {g.disk_bytes ? ` · ${fmtBytes(g.disk_bytes)}` : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </nav>
            )}

            {groupSlug ? (
              <div className="grid gap-2 pt-3 border-t border-base-300">
                <div className="flex items-center gap-2 px-1">
                  <Layers3 className={`h-3.5 w-3.5 ${muted}`} aria-hidden />
                  <h3 className="text-xs font-bold m-0">Services</h3>
                  <span className={`text-[11px] ${muted}`}>{services.length}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs ml-auto text-primary"
                    onClick={openAddService}
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    Add
                  </button>
                </div>
                {servicesQ.isLoading ? (
                  <Spinner compact label="Loading services…" />
                ) : services.length ? (
                  <nav className="grid gap-1" aria-label="Services in selected group">
                    {services.map((svc) => {
                      const Icon = serviceTypeIcon(svc.type)
                      const busy = isBuilding(svc) || (activity.active && activity.scope?.startsWith(`${groupSlug}/${svc.slug}`))
                      const waiting = isQueued(svc) && !busy
                      const tone = statusTone(svc, { busy, waiting })
                      const label = statusLabel(svc)
                      return (
                        <Link
                          key={svc.slug}
                          to={`/projects/${encodeURIComponent(groupSlug)}/${encodeURIComponent(svc.slug)}`}
                          className={[
                            'group flex items-center gap-2 rounded-box border px-2.5 py-2 transition-all duration-200',
                            svc.slug === serviceSlug
                              ? 'border-primary/40 bg-primary/10 text-primary shadow-sm'
                              : 'border-transparent hover:border-base-300 hover:bg-base-200/70',
                          ].join(' ')}
                        >
                          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <strong className="block text-xs truncate">{svc.name || svc.slug}</strong>
                            <span className={`flex items-center gap-1.5 text-[10px] ${muted}`}>
                              <span className={`status ${statusDot(tone)}`} aria-hidden />
                              {busy ? 'Deploying' : waiting ? 'Queued' : label.text}
                            </span>
                          </span>
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-info" aria-hidden /> : null}
                        </Link>
                      )
                    })}
                  </nav>
                ) : (
                  <p className={`text-[11px] m-0 px-1 ${muted}`}>No services in this group yet.</p>
                )}
              </div>
            ) : null}
          </div>
        </aside>

        <section
          className={`card ${surface} section-enter ${deployingN ? 'border-info/40' : ''}`}
        >
          <div className="card-body gap-4 p-3 sm:p-4">
            {!groupSlug ? (
              <div className={`grid place-items-center gap-2 min-h-[280px] text-center ${muted}`}>
                <h3 className="text-base font-bold m-0 text-base-content">
                  {(groupsQ.data || []).length ? 'Select a group' : 'Create a group'}
                </h3>
                <p className={`text-sm ${muted} m-0`}>Groups hold databases and Go apps on this Pi.</p>
                {!(groupsQ.data || []).length ? (
                  <Button
                    variant="primary"
                    icon={<Plus className="h-4 w-4" aria-hidden />}
                    onClick={() => setWizard('group')}
                  >
                    New group
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <header
                  className={`grid grid-cols-[auto_minmax(0,1fr)] sm:flex items-start gap-2.5 pb-3 border-b border-base-300 ${
                    deployingN ? 'relative after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:rounded after:bg-gradient-to-r after:from-info/20 after:via-info after:to-info/20 after:bg-[length:220%_100%] motion-safe:after:animate-pulse' : ''
                  }`}
                >
                  <Button
                    variant="quiet"
                    icon={<ArrowLeft className="h-4 w-4" aria-hidden />}
                    onClick={() => navigate('/projects')}
                    aria-label="Back"
                  />
                  <div className="flex-1 min-w-0 grid gap-1">
                    <div className="flex gap-2 items-center">
                      <Input
                        className="w-full min-w-0 max-w-[360px] h-10 text-lg font-semibold tracking-tight"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        aria-label="Group name"
                      />
                      {nameDirty ? (
                        <Button variant="primary" loading={renameMut.isPending} onClick={() => renameMut.mutate()}>
                          Save
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs ${muted}`}>{groupSlug}</span>
                      {deployingN ? (
                        <span className="badge badge-info badge-sm gap-1" role="status">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          {phaseLabel(activity.progress?.phase) ||
                            activity.progress?.label ||
                            'Deploying'}
                          {queuedN ? ` · ${queuedN} queued` : buildingN > 1 ? ` · ${buildingN}` : ''}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="col-span-2 flex flex-wrap justify-end gap-1.5 sm:ml-auto">
                    <Button
                      variant="dangerSoft"
                      icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                      loading={deleteGroupMut.isPending}
                      onClick={() => void onDeleteGroup()}
                    >
                      Delete
                    </Button>
                    <Button
                      variant="primary"
                      icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                      onClick={openAddService}
                    >
                      Add service
                    </Button>
                  </div>
                </header>

                <div className="grid gap-3">
                  <DeployQueue activity={activity} group={groupSlug} />

                {servicesQ.isLoading ? (
                  <Spinner compact label="Loading services…" />
                ) : servicesQ.isError ? (
                  <Empty compact title="Could not load services" body={(servicesQ.error as Error).message} />
                ) : !services.length ? (
                  <Empty
                    title="Nothing here yet"
                    body="Add a Go app, Postgres, or Bucket."
                    action={
                      <Button
                        variant="primary"
                        icon={<Plus className="h-4 w-4" aria-hidden />}
                        onClick={openAddService}
                      >
                        Add service
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
                    {services.map((svc) => (
                      <ServiceCard
                        key={svc.slug}
                        group={groupSlug}
                        svc={svc}
                        selected={svc.slug === serviceSlug}
                        activity={activity}
                        sseLive={live}
                        actPending={svcAct.isPending && svcAct.variables?.slug === svc.slug}
                        onAction={(slug, action) => void onServiceAction(slug, action)}
                      />
                    ))}
                  </div>
                )}

                {selected ? (
                  <ServiceDetail
                    group={groupSlug}
                    slug={selected.slug}
                    siblings={services}
                    onClose={() => navigate(`/projects/${encodeURIComponent(groupSlug)}`)}
                    onDeleted={() => navigate(`/projects/${encodeURIComponent(groupSlug)}`)}
                  />
                ) : null}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <Modal
        open={wizard === 'group'}
        title="New group"
        sub="Boundary for databases and Go apps."
        onClose={() => setWizard(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setWizard(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createGroupMut.isPending}
              disabled={!groupName.trim()}
              onClick={() => createGroupMut.mutate()}
            >
              Create
            </Button>
          </>
        }
      >
        <Field label="Name" tip="Becomes the group slug (lowercase, hyphens)." htmlFor="wiz-group-name">
          <Input
            id="wiz-group-name"
            autoFocus
            placeholder="my-api"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && groupName.trim()) createGroupMut.mutate()
            }}
          />
        </Field>
        {groupName.trim() ? (
          <p className={`text-sm ${muted} font-mono m-0 mt-2`}>{slugify(groupName)}</p>
        ) : null}
      </Modal>

      <Modal
        open={wizard === 'type'}
        title="Choose a service"
        sub={
          <>
            In <strong>{groupSlug}</strong>
          </>
        }
        onClose={() => setWizard(null)}
      >
        <div className="grid gap-3">
          <div className="flex gap-2.5 rounded-box border border-primary/20 bg-primary/5 p-3">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden />
            <p className={`text-xs m-0 ${muted}`}>
              Everything stays inside <strong className="text-base-content">{groupSlug}</strong>. Containers, credentials,
              volumes, and network links are scoped to this group.
            </p>
          </div>
          <div className="grid gap-2">
          <Choice
            title="Go app"
            description="Deploy a container from GitHub and link its dependencies"
            icon={<Box className="h-5 w-5" aria-hidden />}
            onClick={pickGo}
          />
          <Choice
            title="Postgres"
            description="Private database with app-ready connection variables"
            tone="success"
            icon={<Database className="h-5 w-5" aria-hidden />}
            onClick={() => setWizard('postgres')}
          />
          <Choice
            title="Bucket"
            description="S3-compatible object storage with scoped credentials"
            icon={<Archive className="h-5 w-5" aria-hidden />}
            onClick={() => setWizard('bucket')}
          />
          </div>
        </div>
      </Modal>

      <Modal
        open={wizard === 'github'}
        title="Connect GitHub"
        sub="Required to deploy a Go app from a repository."
        onClose={() => setWizard(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setWizard('type')}>
              Back
            </Button>
            <Button
              variant="primary"
              icon={<FolderGit2 className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setPending({ group: groupSlug })
                setWizard(null)
                navigate('/settings')
              }}
            >
              Open Settings
            </Button>
          </>
        }
      >
        <p className={`text-sm ${muted} m-0`}>
          Connect GitHub in Settings with a personal access token (repo read). Then come back and add your Go app.
        </p>
      </Modal>

      <Modal
        open={wizard === 'go'}
        title="Add Go app"
        sub={
          <>
            In <strong>{groupSlug}</strong>
          </>
        }
        size="md"
        onClose={() => setWizard(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setWizard('type')}>
              Back
            </Button>
            <Button variant="quiet" onClick={() => setWizard(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={deployMut.isPending}
              disabled={!goForm.repo}
              onClick={() => deployMut.mutate()}
            >
              Deploy
            </Button>
          </>
        }
      >
        <Field
          label="Repository"
          meta={reposQ.data ? `${reposQ.data.length} available` : 'Loading…'}
          tip="Private repos need the GitHub token from Settings."
        >
          <Select
            value={goForm.repo}
            onChange={(e) => setGoForm((f) => ({ ...f, repo: e.target.value, branch: '', root_dir: '' }))}
          >
            <option value="">Search repositories…</option>
            {(reposQ.data || []).map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Branch" tip="Deploy clones this branch on every build.">
          <Select
            value={goForm.branch}
            disabled={!goForm.repo || branchesQ.isLoading}
            onChange={(e) => setGoForm((f) => ({ ...f, branch: e.target.value, root_dir: '' }))}
          >
            <option value="">{goForm.repo ? 'Select branch…' : 'Pick a repo first'}</option>
            {(branchesQ.data || []).map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.default ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Root"
          tip="Browse folders or pick a detected go.mod. Leave at repo root when go.mod is at the top."
        >
          <RepoRootPicker
            repo={goForm.repo}
            branch={goForm.branch}
            value={goForm.root_dir}
            onChange={(root_dir) => setGoForm((f) => ({ ...f, root_dir }))}
            disabled={!goForm.repo || !goForm.branch}
          />
        </Field>
        <Field
          label="Database"
          meta="link"
          tip={
            goForm.linked_database
              ? `Runtime injects ${LINKED_DB_KEYS.slice(0, 4).join(', ')}… from the database`
              : 'Optional Postgres already in this group.'
          }
        >
          <Select
            value={goForm.linked_database}
            onChange={(e) => setGoForm((f) => ({ ...f, linked_database: e.target.value }))}
          >
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
          meta="link"
          tip={
            goForm.linked_bucket
              ? `Runtime injects ${LINKED_BUCKET_KEYS.slice(0, 4).join(', ')}… from the bucket`
              : 'Optional object storage already in this group.'
          }
        >
          <Select
            value={goForm.linked_bucket}
            onChange={(e) => setGoForm((f) => ({ ...f, linked_bucket: e.target.value }))}
          >
            <option value="">No bucket</option>
            {buckets.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name || d.slug}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Port"
          meta={portsQ.data?.free != null ? `${portsQ.data.free} free` : 'auto'}
          tip="Assigned automatically from the free pool on this Pi."
        >
          <div className={`flex items-baseline gap-2 h-[34px] px-2.5 ${tile}`}>
            <strong>{portsQ.data?.next ?? '…'}</strong>
            <span className={`text-sm ${muted}`}>assigned on deploy</span>
          </div>
        </Field>

        <ResourceBudget
          host={hostCapacity(state.device_metrics)}
          reserved={reservedFromServices(services, {
            draft: {
              memory_mb: clampMem(goForm.memory_mb),
              cpus: clampCpu(goForm.cpus),
            },
          })}
          draftLabel="including new app"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <ResourceSlider
            id="go-mem"
            label="Memory"
            unit="MB"
            min={RESOURCE.memMin}
            max={RESOURCE.memMax}
            step={64}
            value={clampMem(goForm.memory_mb)}
            onChange={(memory_mb) => setGoForm((f) => ({ ...f, memory_mb }))}
            meta={`${clampMem(goForm.memory_mb)}MB`}
            tip="Docker memory limit for this app."
          />
          <ResourceSlider
            id="go-cpu"
            label="CPUs"
            min={RESOURCE.cpuMin}
            max={RESOURCE.cpuMax}
            step={RESOURCE.cpuStep}
            value={clampCpu(goForm.cpus)}
            onChange={(cpus) => setGoForm((f) => ({ ...f, cpus }))}
            meta={`${clampCpu(goForm.cpus)} cores`}
            tip="Docker CPU share for this app."
          />
        </div>

        <Field label="Environment" meta="optional" tip="One KEY=value per line. Linked DB/bucket keys are added later.">
          <TextArea
            value={goForm.env}
            onChange={(e) => setGoForm((f) => ({ ...f, env: e.target.value }))}
            placeholder={'LOG_LEVEL=info'}
          />
        </Field>
      </Modal>

      <Modal
        open={wizard === 'postgres'}
        title="Add Postgres"
        sub="Create a private database, then link it to an app in this group."
        onClose={() => setWizard(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setWizard('type')}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={pgMut.isPending}
              disabled={!pgName.trim()}
              onClick={() => pgMut.mutate()}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
        <Field label="Name" tip="Prefix is added automatically" htmlFor="wiz-pg-name">
          <Input id="wiz-pg-name" autoFocus value={pgName} onChange={(e) => setPgName(e.target.value)} />
        </Field>
        <div className={`${tile} p-3 grid gap-1.5`}>
          <strong className="text-xs">Ready for application code</strong>
          <p className={`text-[11px] m-0 ${muted}`}>
            We create isolated credentials and expose <span className="font-mono">DATABASE_URL</span> plus standard
            Postgres variables only to apps you explicitly link.
          </p>
        </div>
        </div>
      </Modal>

      <Modal
        open={wizard === 'bucket'}
        title="Add Bucket"
        sub="Create S3-compatible storage, then connect it to an app in this group."
        onClose={() => setWizard(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setWizard('type')}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={bucketMut.isPending}
              disabled={!bucketName.trim()}
              onClick={() => bucketMut.mutate()}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
        <Field label="Name" tip="Prefix is added automatically" htmlFor="wiz-bucket-name">
          <Input
            id="wiz-bucket-name"
            autoFocus
            value={bucketName}
            onChange={(e) => setBucketName(e.target.value)}
          />
        </Field>
        <div className={`${tile} p-3 grid gap-1.5`}>
          <strong className="text-xs">Secure by default</strong>
          <p className={`text-[11px] m-0 ${muted}`}>
            A dedicated bucket and credentials are created for this service. Link it to a Go app to inject the endpoint,
            bucket name, access key, secret, and path-style setting.
          </p>
        </div>
        </div>
      </Modal>
    </div>
  )
}
