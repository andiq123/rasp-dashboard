import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Box,
  Database,
  Folder,
  FolderGit2,
  Loader2,
  Plus,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react'
import {
  createBucket,
  createGroup,
  createPostgres,
  deleteGroup,
  deployGo,
  fetchBranches,
  fetchDirs,
  fetchGitHubStatus,
  fetchGroups,
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
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input, Select, TextArea } from '@/components/ui/Field/Field'
import { Modal } from '@/components/ui/Modal/Modal'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { fmtBytes, slugify } from '@/lib/format'
import { muted, surface, tile } from '@/lib/ui'
import { usePendingAddGo } from './pendingAddGo'
import { ServiceDetail } from './ServiceDetail'
import { isBuilding, statusLabel } from './serviceStatus'
import { activityMatchesGroup, activityMatchesService, useActivity } from '@/hooks/useActivity'

type WizardStep = 'type' | 'github' | 'group' | 'go' | 'postgres' | 'bucket' | null

export function ProjectsPage() {
  const { '*': splat } = useParams()
  const parts = (splat || '').split('/').filter(Boolean)
  const groupSlug = parts[0] || ''
  const serviceSlug = parts[1] || ''
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const { showToast } = useToast()
  const qc = useQueryClient()
  const { setPending } = usePendingAddGo()
  const { activity, live } = useActivity()

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
  const ghQ = useQuery({ queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus })

  const group = (groupsQ.data || []).find((g) => g.slug === groupSlug)
  const services = servicesQ.data || []
  const selected = services.find((s) => s.slug === serviceSlug)
  const buildingN = services.filter(isBuilding).length
  const liveDeploying = activity.active && activityMatchesGroup(activity, groupSlug)
  const deployingN = Math.max(buildingN, liveDeploying ? 1 : 0)

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
  const dirsQ = useQuery({
    queryKey: queryKeys.githubDirs(goForm.repo, goForm.branch),
    queryFn: () => fetchDirs(goForm.repo, goForm.branch),
    enabled: wizard === 'go' && !!goForm.repo && !!goForm.branch,
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

  useEffect(() => {
    if (dirsQ.data?.suggested_root && !goForm.root_dir) {
      setGoForm((f) => ({ ...f, root_dir: dirsQ.data!.suggested_root || '' }))
    }
  }, [dirsQ.data, goForm.root_dir])

  const createGroupMut = useMutation({
    mutationFn: () => createGroup(groupName.trim()),
    onSuccess: async (g) => {
      showToast('Group created')
      setWizard(null)
      setGroupName('')
      await qc.invalidateQueries({ queryKey: queryKeys.groups })
      navigate(`/projects/${encodeURIComponent(g.slug)}`)
    },
    onError: (e: Error) => showToast(e.message),
  })

  const renameMut = useMutation({
    mutationFn: () => renameGroup(groupSlug, draftName.trim()),
    onSuccess: async () => {
      showToast('Saved')
      await qc.invalidateQueries({ queryKey: queryKeys.groups })
    },
    onError: (e: Error) => showToast(e.message),
  })

  const deleteGroupMut = useMutation({
    mutationFn: () => deleteGroup(groupSlug),
    onSuccess: async () => {
      showToast('Group deleted')
      await qc.invalidateQueries({ queryKey: queryKeys.groups })
      navigate('/projects')
    },
    onError: (e: Error) => showToast(e.message),
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
    onSuccess: async () => {
      showToast('Deploying…')
      setWizard(null)
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
    },
    onError: (e: Error) => showToast(e.message || 'Deploy failed'),
  })

  const pgMut = useMutation({
    mutationFn: () => createPostgres(groupSlug, { type: 'postgres', name: pgName.trim(), version: 'latest' }),
    onSuccess: async () => {
      showToast('Postgres creating…')
      setWizard(null)
      setPgName('')
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
    },
    onError: (e: Error) => showToast(e.message),
  })

  const bucketMut = useMutation({
    mutationFn: () => createBucket(groupSlug, { type: 'bucket', name: bucketName.trim() }),
    onSuccess: async () => {
      showToast('Bucket creating…')
      setWizard(null)
      setBucketName('')
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
    },
    onError: (e: Error) => showToast(e.message),
  })

  const svcAct = useMutation({
    mutationFn: ({ slug, action }: { slug: string; action: string }) =>
      serviceAction(groupSlug, slug, action),
    onSuccess: async (_, v) => {
      showToast(v.action)
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
    },
    onError: (e: Error) => showToast(e.message),
  })

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
        <aside className={`card ${surface}`}>
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
              <Spinner label="Loading groups…" />
            ) : groupsQ.isError ? (
              <Empty title="Could not load groups" body={(groupsQ.error as Error).message} />
            ) : !(groupsQ.data || []).length ? (
              <Empty title="No groups yet" body="Create a group to deploy apps and databases." />
            ) : (
              <nav className="menu menu-sm gap-1 p-0" aria-label="Groups">
                {(groupsQ.data || []).map((g) => (
                  <li key={g.slug}>
                    <Link
                      to={`/projects/${encodeURIComponent(g.slug)}`}
                      className={
                        g.slug === groupSlug
                          ? 'active bg-primary/15 text-primary border border-primary/30'
                          : 'border border-transparent'
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
          </div>
        </aside>

        <section
          className={`card ${surface} ${deployingN ? 'border-info/40' : ''}`}
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
                  className={`flex items-start gap-2.5 pb-3 border-b border-base-300 ${
                    deployingN ? 'relative after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:rounded after:bg-gradient-to-r after:from-info/20 after:via-info after:to-info/20 after:bg-[length:220%_100%] after:animate-pulse' : ''
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
                        className="max-w-[360px] h-10 text-lg font-semibold tracking-tight"
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
                          {activity.progress?.label || 'Deploying'}
                          {buildingN > 1 ? ` · ${buildingN}` : ''}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="join join-horizontal flex-wrap gap-1.5">
                    <Button
                      variant="dangerSoft"
                      icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                      loading={deleteGroupMut.isPending}
                      onClick={() => {
                        if (confirm(`Delete group ${groupSlug}?`)) deleteGroupMut.mutate()
                      }}
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

                {servicesQ.isLoading ? (
                  <Spinner label="Loading services…" />
                ) : servicesQ.isError ? (
                  <Empty title="Could not load services" body={(servicesQ.error as Error).message} />
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
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
                    {services.map((svc) => {
                      const st = statusLabel(svc)
                      const building = isBuilding(svc)
                      const liveHere =
                        activityMatchesService(activity, groupSlug, svc.slug) && activity.active
                      const busy = building || liveHere
                      return (
                        <button
                          type="button"
                          key={svc.slug}
                          className={[
                            `card ${surface} text-left cursor-pointer transition-colors hover:border-primary/40`,
                            busy ? 'border-info/40' : '',
                            svc.slug === serviceSlug ? 'border-primary ring-2 ring-primary/20' : '',
                          ].join(' ')}
                          onClick={() =>
                            navigate(`/projects/${encodeURIComponent(groupSlug)}/${encodeURIComponent(svc.slug)}`)
                          }
                        >
                          <div className="card-body gap-2 p-3">
                            <div className="flex justify-between gap-2 items-start">
                              <strong className="text-sm">{svc.name || svc.slug}</strong>
                              <span className={`badge badge-sm ${busy ? 'badge-info' : st.badge}`}>
                                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                                {liveHere && activity.progress?.label ? activity.progress.label : st.text}
                              </span>
                            </div>
                            <div className={`text-xs ${muted}`}>
                              <span className="font-mono">{svc.type}</span>
                              {svc.port ? ` · :${svc.port}` : ''}
                              {svc.repo ? ` · ${svc.repo}` : ''}
                            </div>
                            {svc.type === 'go' ? (
                              <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                                {busy ? (
                                  <span className="badge badge-info badge-sm gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                                    {activity.progress?.label || 'Building…'}
                                  </span>
                                ) : svc.running ? (
                                  <Button
                                    variant="quiet"
                                    icon={<Square className="h-3.5 w-3.5" aria-hidden />}
                                    loading={svcAct.isPending}
                                    onClick={() => svcAct.mutate({ slug: svc.slug, action: 'stop' })}
                                  >
                                    Stop
                                  </Button>
                                ) : (
                                  <Button
                                    variant="primary"
                                    icon={<Play className="h-3.5 w-3.5" aria-hidden />}
                                    loading={svcAct.isPending}
                                    onClick={() => svcAct.mutate({ slug: svc.slug, action: 'start' })}
                                  >
                                    Start
                                  </Button>
                                )}
                                <Button
                                  variant="quiet"
                                  icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                                  loading={svcAct.isPending}
                                  onClick={() => svcAct.mutate({ slug: svc.slug, action: 'redeploy' })}
                                >
                                  Redeploy
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </button>
                      )
                    })}
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
        title="Add service"
        sub={
          <>
            In <strong>{groupSlug}</strong>
          </>
        }
        onClose={() => setWizard(null)}
      >
        <div className="grid gap-2">
          <Choice
            title="Go app"
            description="Clone from GitHub, build, and run"
            icon={<Box className="h-5 w-5" aria-hidden />}
            onClick={pickGo}
          />
          <Choice
            title="Postgres"
            description="Shared database for apps"
            tone="success"
            icon={<Database className="h-5 w-5" aria-hidden />}
            onClick={() => setWizard('postgres')}
          />
          <Choice
            title="Bucket"
            description="Object storage on this Pi"
            icon={<Box className="h-5 w-5" aria-hidden />}
            onClick={() => setWizard('bucket')}
          />
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
        <Field label="Repository" meta={reposQ.data ? `${reposQ.data.length} available` : 'Loading…'}>
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
        <Field label="Branch">
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
        <Field label="Root" tip="Monorepo folder with go.mod">
          <Select
            value={goForm.root_dir}
            disabled={!goForm.repo || dirsQ.isLoading}
            onChange={(e) => setGoForm((f) => ({ ...f, root_dir: e.target.value }))}
          >
            <option value="">Repository root</option>
            {(dirsQ.data?.go_modules || []).map((m) => (
              <option key={m.path} value={m.path}>
                {m.path}
              </option>
            ))}
            {(dirsQ.data?.dirs || [])
              .filter((d) => !(dirsQ.data?.go_modules || []).some((m) => m.path === d.path))
              .map((d) => (
                <option key={d.path} value={d.path}>
                  {d.path}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Database" meta="link" tip={goForm.linked_database ? `Injects ${LINKED_DB_KEYS.slice(0, 5).join(', ')}…` : undefined}>
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
        <Field label="Bucket" meta="link" tip={goForm.linked_bucket ? `Injects ${LINKED_BUCKET_KEYS.join(', ')}` : undefined}>
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
        <Field label="Port" meta={portsQ.data?.free != null ? `${portsQ.data.free} free` : 'auto'}>
          <div className={`flex items-baseline gap-2 h-[34px] px-2.5 ${tile}`}>
            <strong>{portsQ.data?.next ?? '…'}</strong>
            <span className={`text-sm ${muted}`}>assigned on deploy</span>
          </div>
        </Field>
        <Field label="Environment" meta="optional KEY=value">
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
        <Field label="Name" tip="Prefix is added automatically" htmlFor="wiz-pg-name">
          <Input id="wiz-pg-name" autoFocus value={pgName} onChange={(e) => setPgName(e.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={wizard === 'bucket'}
        title="Add Bucket"
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
        <Field label="Name" tip="Prefix is added automatically" htmlFor="wiz-bucket-name">
          <Input
            id="wiz-bucket-name"
            autoFocus
            value={bucketName}
            onChange={(e) => setBucketName(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  )
}
