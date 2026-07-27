import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createBucket,
  createGroup,
  createPostgres,
  deleteGroup,
  deleteService,
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
import type { Service } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input, Select, TextArea } from '@/components/ui/Field/Field'
import { Modal } from '@/components/ui/Modal/Modal'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { fmtBytes, fmtRelative, slugify } from '@/lib/format'
import { usePendingAddGo } from './pendingAddGo'
import styles from './ProjectsPage.module.css'

function isBuilding(svc: Service): boolean {
  if (svc.type === 'postgres' || svc.type === 'bucket') return false
  if (svc.status === 'building') return true
  return !!(svc.deployments || []).some((d) => d.status === 'building' || d.status === 'queued')
}

function statusLabel(svc: Service): { text: string; cls: string } {
  if (svc.type === 'postgres' || svc.type === 'bucket') {
    return svc.running ? { text: 'Ready', cls: styles.ok } : { text: 'Offline', cls: styles.off }
  }
  if (isBuilding(svc)) return { text: 'Building', cls: styles.build }
  if (svc.status === 'failed') return { text: 'Failed', cls: styles.fail }
  if (svc.running) return { text: 'Running', cls: styles.ok }
  return { text: 'Stopped', cls: styles.off }
}

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

  const groupsQ = useQuery({ queryKey: queryKeys.groups, queryFn: fetchGroups, refetchInterval: 12_000 })
  const servicesQ = useQuery({
    queryKey: queryKeys.services(groupSlug),
    queryFn: () => fetchServices(groupSlug),
    enabled: !!groupSlug,
    refetchInterval: 5_000,
  })
  const ghQ = useQuery({ queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus })

  const group = (groupsQ.data || []).find((g) => g.slug === groupSlug)
  const services = servicesQ.data || []
  const selected = services.find((s) => s.slug === serviceSlug)
  const buildingN = services.filter(isBuilding).length

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

  const svcDel = useMutation({
    mutationFn: (slug: string) => deleteService(groupSlug, slug),
    onSuccess: async () => {
      showToast('Deleted')
      navigate(`/projects/${encodeURIComponent(groupSlug)}`)
      await qc.invalidateQueries({ queryKey: queryKeys.services(groupSlug) })
    },
    onError: (e: Error) => showToast(e.message),
  })

  const dbs = useMemo(() => services.filter((s) => s.type === 'postgres'), [services])
  const buckets = useMemo(() => services.filter((s) => s.type === 'bucket'), [services])

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
    <div className={styles.page}>
      <div className={styles.split}>
        <aside className={styles.sidebar}>
          <div className={styles.sideHead}>
            <h3>Groups</h3>
            <span className={styles.count}>{(groupsQ.data || []).length}</span>
            <Button variant="primary" className={styles.newGroup} onClick={() => setWizard('group')}>
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
            <div className={styles.groupList}>
              {(groupsQ.data || []).map((g) => (
                <Link
                  key={g.slug}
                  to={`/projects/${encodeURIComponent(g.slug)}`}
                  className={`${styles.groupTile} ${g.slug === groupSlug ? styles.groupActive : ''}`}
                >
                  <strong>{g.name || g.slug}</strong>
                  <span className="mono">
                    {g.slug}
                    {g.service_count != null ? ` · ${g.service_count}` : ''}
                    {g.disk_bytes ? ` · ${fmtBytes(g.disk_bytes)}` : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </aside>

        <section className={`${styles.main} ${buildingN ? styles.deploying : ''}`}>
          {!groupSlug ? (
            <div className={styles.welcome}>
              <h3>{(groupsQ.data || []).length ? 'Select a group' : 'Create a group'}</h3>
              <p className="ghost">Groups hold databases and Go apps on this Pi.</p>
              {!(groupsQ.data || []).length ? (
                <Button variant="primary" onClick={() => setWizard('group')}>
                  New group
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <header className={styles.gdHead}>
                <Button variant="quiet" onClick={() => navigate('/projects')} aria-label="Back">
                  ←
                </Button>
                <div className={styles.gdIdentity}>
                  <div className={styles.nameRow}>
                    <Input
                      className={styles.nameInput}
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
                  <div className={styles.meta}>
                    <span className="mono">{groupSlug}</span>
                    {buildingN ? (
                      <span className={styles.deployingPill} role="status">
                        Deploying{buildingN > 1 ? ` · ${buildingN}` : ''}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className={styles.headActions}>
                  <Button
                    variant="dangerSoft"
                    loading={deleteGroupMut.isPending}
                    onClick={() => {
                      if (confirm(`Delete group ${groupSlug}?`)) deleteGroupMut.mutate()
                    }}
                  >
                    Delete
                  </Button>
                  <Button variant="primary" onClick={openAddService}>
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
                    <Button variant="primary" onClick={openAddService}>
                      Add service
                    </Button>
                  }
                />
              ) : (
                <div className={styles.board}>
                  {services.map((svc) => {
                    const st = statusLabel(svc)
                    return (
                      <button
                        type="button"
                        key={svc.slug}
                        className={`${styles.card} ${isBuilding(svc) ? styles.cardBuild : ''} ${
                          svc.slug === serviceSlug ? styles.cardSelected : ''
                        }`}
                        onClick={() =>
                          navigate(`/projects/${encodeURIComponent(groupSlug)}/${encodeURIComponent(svc.slug)}`)
                        }
                      >
                        <div className={styles.cardTop}>
                          <strong>{svc.name || svc.slug}</strong>
                          <span className={`${styles.badge} ${st.cls}`}>{st.text}</span>
                        </div>
                        <div className={styles.cardSub}>
                          <span className="mono">{svc.type}</span>
                          {svc.port ? ` · :${svc.port}` : ''}
                          {svc.repo ? ` · ${svc.repo}` : ''}
                        </div>
                        {svc.type === 'go' ? (
                          <div className={styles.cardActs} onClick={(e) => e.stopPropagation()}>
                            {isBuilding(svc) ? (
                              <span className={styles.buildingNote}>Building…</span>
                            ) : svc.running ? (
                              <Button
                                variant="quiet"
                                loading={svcAct.isPending}
                                onClick={() => svcAct.mutate({ slug: svc.slug, action: 'stop' })}
                              >
                                Stop
                              </Button>
                            ) : (
                              <Button
                                variant="primary"
                                loading={svcAct.isPending}
                                onClick={() => svcAct.mutate({ slug: svc.slug, action: 'start' })}
                              >
                                Start
                              </Button>
                            )}
                            <Button
                              variant="quiet"
                              loading={svcAct.isPending}
                              onClick={() => svcAct.mutate({ slug: svc.slug, action: 'redeploy' })}
                            >
                              Redeploy
                            </Button>
                          </div>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              )}

              {selected ? (
                <div className={styles.drawer}>
                  <div className={styles.drawerHead}>
                    <div>
                      <h3>{selected.name || selected.slug}</h3>
                      <p className="ghost mono">
                        {selected.type}
                        {selected.port ? ` · :${selected.port}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="quiet"
                      onClick={() => navigate(`/projects/${encodeURIComponent(groupSlug)}`)}
                    >
                      Close
                    </Button>
                  </div>
                  <div className={styles.drawerBody}>
                    {selected.url || selected.public_url ? (
                      <p>
                        <a href={selected.public_url || selected.url} target="_blank" rel="noreferrer">
                          {selected.public_url || selected.url}
                        </a>
                      </p>
                    ) : null}
                    {selected.last_error ? <p className={styles.err}>{selected.last_error}</p> : null}
                    {(selected.deployments || []).length ? (
                      <div className={styles.deploys}>
                        <h4>Deploys</h4>
                        <ul>
                          {(selected.deployments || []).slice(0, 8).map((d) => (
                            <li key={d.id}>
                              <span className={styles.badge}>{d.status}</span>{' '}
                              {d.message || d.commit?.slice(0, 7) || d.id}{' '}
                              <span className="ghost">{fmtRelative(d.created_at)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className={styles.drawerActs}>
                      {selected.type === 'go' && !isBuilding(selected) ? (
                        <Button
                          variant="primary"
                          loading={svcAct.isPending}
                          onClick={() =>
                            svcAct.mutate({
                              slug: selected.slug,
                              action: selected.running ? 'stop' : 'start',
                            })
                          }
                        >
                          {selected.running ? 'Stop' : 'Start'}
                        </Button>
                      ) : null}
                      <Button
                        variant="dangerSoft"
                        loading={svcDel.isPending}
                        onClick={() => {
                          if (confirm(`Delete ${selected.slug}?`)) svcDel.mutate(selected.slug)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
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
        {groupName.trim() ? <p className="ghost mono">{slugify(groupName)}</p> : null}
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
        <div className={styles.typePick}>
          <button type="button" className={styles.typeOpt} onClick={pickGo}>
            <span className={`${styles.typeIcon} ${styles.go}`}>Go</span>
            <span>
              <strong>Go app</strong>
              <span className="ghost">Clone from GitHub, build, and run</span>
            </span>
          </button>
          <button type="button" className={styles.typeOpt} onClick={() => setWizard('postgres')}>
            <span className={`${styles.typeIcon} ${styles.pg}`}>DB</span>
            <span>
              <strong>Postgres</strong>
              <span className="ghost">Shared database for apps</span>
            </span>
          </button>
          <button type="button" className={styles.typeOpt} onClick={() => setWizard('bucket')}>
            <span className={`${styles.typeIcon} ${styles.go}`}>S3</span>
            <span>
              <strong>Bucket</strong>
              <span className="ghost">Object storage on this Pi</span>
            </span>
          </button>
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
        <p className="ghost">
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
        <Field label="Database" meta="link">
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
        <Field label="Bucket" meta="link">
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
          <div className={styles.port}>
            <strong>{portsQ.data?.next ?? '…'}</strong>
            <span className="ghost">assigned on deploy</span>
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
