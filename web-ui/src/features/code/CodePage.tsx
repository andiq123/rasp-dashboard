import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, File, Folder, FolderGit2 } from 'lucide-react'
import {
  fetchBranches,
  fetchGitHubContents,
  fetchGitHubFile,
  fetchGitHubStatus,
  fetchRepos,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { Field, Input, Select } from '@/components/ui/Field/Field'
import { PageHeader, PageSub } from '@/components/ui/PageHeader/PageHeader'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { fmtBytes } from '@/lib/format'
import { codeSurface, muted, surface } from '@/lib/ui'

function parentDir(path: string): string {
  const p = path.replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  if (i <= 0) return ''
  return p.slice(0, i)
}

export function CodePage() {
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const repo = search.get('repo') || ''
  const branch = search.get('branch') || ''
  const dir = search.get('path') || ''
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const statusQ = useQuery({ queryKey: queryKeys.githubStatus, queryFn: fetchGitHubStatus })
  const reposQ = useQuery({
    queryKey: queryKeys.githubRepos,
    queryFn: fetchRepos,
    enabled: !!statusQ.data?.connected,
  })
  const branchesQ = useQuery({
    queryKey: queryKeys.githubBranches(repo),
    queryFn: () => fetchBranches(repo),
    enabled: !!repo,
  })
  const contentsQ = useQuery({
    queryKey: queryKeys.githubContents(repo, branch, dir),
    queryFn: () => fetchGitHubContents(repo, branch, dir),
    enabled: !!repo && !!branch,
  })
  const previewQ = useQuery({
    queryKey: queryKeys.githubFile(repo, branch, selected || ''),
    queryFn: () => fetchGitHubFile(repo, branch, selected!),
    enabled: !!repo && !!branch && !!selected,
  })

  useEffect(() => {
    if (!repo || !branchesQ.data?.length) return
    if (branch && branchesQ.data.some((b) => b.name === branch)) return
    const def = branchesQ.data.find((b) => b.default) || branchesQ.data[0]
    if (!def) return
    const next = new URLSearchParams(search)
    next.set('branch', def.name)
    next.delete('path')
    setSearch(next, { replace: true })
    setSelected(null)
  }, [repo, branch, branchesQ.data, search, setSearch])

  useEffect(() => {
    setSelected(null)
  }, [dir, repo, branch])

  const entries = useMemo(() => {
    const list = contentsQ.data || []
    const q = filter.trim().toLowerCase()
    if (!q) return list
    return list.filter((e) => e.name.toLowerCase().includes(q))
  }, [contentsQ.data, filter])

  function setParam(patch: Record<string, string | null>) {
    const next = new URLSearchParams(search)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    setSearch(next, { replace: true })
  }

  if (statusQ.isLoading) {
    return <Spinner label="Checking GitHub…" />
  }

  if (!statusQ.data?.connected) {
    return (
      <div className="mx-auto grid max-w-lg gap-4">
        <PageHeader title="Code">
          <PageSub>Browse repositories after connecting GitHub.</PageSub>
        </PageHeader>
        <Empty
          title="GitHub not connected"
          body="Connect a personal access token in Settings, then come back to browse source."
          action={
            <Button
              variant="primary"
              icon={<FolderGit2 className="h-4 w-4" aria-hidden />}
              onClick={() => navigate('/settings')}
            >
              Open Settings
            </Button>
          }
        />
      </div>
    )
  }

  const crumbs = dir ? dir.split('/').filter(Boolean) : []

  return (
    <div className="grid gap-3">
      <PageHeader title="Code">
        <PageSub>
          Browse {(statusQ.data.user && statusQ.data.user.login) || 'GitHub'} repositories
        </PageSub>
      </PageHeader>

      <div className={`card ${surface}`}>
        <div className="card-body gap-3 p-3 sm:p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Repository">
              <Select
                value={repo}
                onChange={(e) => {
                  setParam({ repo: e.target.value || null, branch: null, path: null })
                  setSelected(null)
                  setFilter('')
                }}
              >
                <option value="">Select a repository…</option>
                {(reposQ.data || []).map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                    {r.language ? ` · ${r.language}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Branch">
              <Select
                value={branch}
                disabled={!repo || branchesQ.isLoading}
                onChange={(e) => {
                  setParam({ branch: e.target.value || null, path: null })
                  setSelected(null)
                }}
              >
                <option value="">{repo ? 'Select branch…' : 'Pick a repo first'}</option>
                {(branchesQ.data || []).map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.default ? ' (default)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {!repo || !branch ? (
            <Empty title="Pick a repository" body="Choose a repo and branch to browse files." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="quiet"
                  icon={<ArrowUp className="h-3.5 w-3.5" aria-hidden />}
                  disabled={!dir}
                  onClick={() => setParam({ path: parentDir(dir) || null })}
                >
                  Up
                </Button>
                <div className={`breadcrumbs text-xs ${muted} py-0`}>
                  <ul className="font-mono">
                    <li>
                      <button type="button" className="link link-hover" onClick={() => setParam({ path: null })}>
                        /
                      </button>
                    </li>
                    {crumbs.map((name, i) => {
                      const built = crumbs.slice(0, i + 1).join('/')
                      return (
                        <li key={built}>
                          <button
                            type="button"
                            className="link link-hover"
                            onClick={() => setParam({ path: built })}
                          >
                            {name}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <Input
                  className="w-40 ml-auto input-sm"
                  placeholder="Filter…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Filter files"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 min-h-[360px] lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
                <div className={`card ${surface} overflow-auto min-h-[320px]`}>
                  {contentsQ.isLoading ? (
                    <Spinner label="Loading…" />
                  ) : contentsQ.isError ? (
                    <div className="p-4">
                      <Empty title="Could not list" body={(contentsQ.error as Error).message} />
                    </div>
                  ) : !entries.length ? (
                    <div className="p-4">
                      <Empty title="Empty folder" />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table table-sm">
                        <thead className="sticky top-0 bg-base-100 z-1">
                          <tr>
                            <th>Name</th>
                            <th>Size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map((e) => (
                            <tr
                              key={e.path}
                              className={`cursor-pointer hover:bg-primary/5 ${
                                selected === e.path ? 'bg-primary/10' : ''
                              }`}
                              onClick={() => {
                                if (e.type === 'dir') setParam({ path: e.path })
                                else setSelected(e.path)
                              }}
                            >
                              <td>
                                <span className="inline-flex items-center gap-2 font-medium">
                                  {e.type === 'dir' ? (
                                    <Folder className={`h-4 w-4 ${muted} shrink-0`} aria-hidden />
                                  ) : (
                                    <File className={`h-4 w-4 ${muted} shrink-0`} aria-hidden />
                                  )}
                                  {e.name}
                                </span>
                              </td>
                              <td className={muted}>{e.type === 'dir' ? '—' : fmtBytes(e.size)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <aside className={`card ${surface} min-h-[320px]`}>
                  <div className="card-body gap-2.5 p-3 grid grid-rows-[auto_1fr]">
                    {!selected ? (
                      <Empty title="Select a file" body="Preview text files from this branch." />
                    ) : previewQ.isLoading ? (
                      <Spinner label="Loading preview…" />
                    ) : previewQ.data?.binary || previewQ.data?.error ? (
                      <Empty
                        title={previewQ.data.binary ? 'Binary file' : 'Preview failed'}
                        body={previewQ.data.error || 'No text preview.'}
                      />
                    ) : (
                      <>
                        <strong className="text-sm truncate inline-flex items-center gap-2">
                          <File className={`h-4 w-4 shrink-0 ${muted}`} aria-hidden />
                          {previewQ.data?.name || selected.split('/').pop()}
                          {previewQ.data?.truncated ? (
                            <span className={`text-xs font-normal ${muted}`}>truncated</span>
                          ) : null}
                        </strong>
                        <pre className={codeSurface}>{previewQ.data?.text || ''}</pre>
                      </>
                    )}
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
