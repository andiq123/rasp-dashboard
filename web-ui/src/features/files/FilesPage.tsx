import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Eye, EyeOff, File, Folder, Home, Trash2 } from 'lucide-react'
import { fetchFilePreview, fetchFiles, filesOp, readInitialState } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { FilesEntry } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Empty } from '@/components/ui/Empty/Empty'
import { Input } from '@/components/ui/Field/Field'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { fmtBytes } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader/PageHeader'
import { codeSurface, muted, surface } from '@/lib/ui'

function parentPath(path: string): string {
  const p = path.replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  if (i <= 0) return '/'
  return p.slice(0, i) || '/'
}

/** Dotfile / hidden folder — matches server `hidden` (name starts with "."). */
function isHiddenEntry(e: FilesEntry): boolean {
  if (e.hidden === true) return true
  return e.name.startsWith('.')
}

export function FilesPage() {
  const { '*': splat } = useParams()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const home = readInitialState().files_root || '/home'
  const pathFromRoute = splat ? `/${splat}` : ''
  const path = pathFromRoute || home
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const listingQ = useQuery({
    queryKey: queryKeys.files(path),
    queryFn: () => fetchFiles(path),
  })

  const previewQ = useQuery({
    queryKey: queryKeys.filesPreview(selected || ''),
    queryFn: () => fetchFilePreview(selected!),
    enabled: !!selected,
  })

  const delMut = useMutation({
    mutationFn: (p: string) => filesOp({ op: 'delete', path: p }),
    onSuccess: async () => {
      showToast('File deleted')
      setSelected(null)
      await qc.invalidateQueries({ queryKey: queryKeys.files(path) })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  async function onDeleteSelected() {
    if (!selected) return
    const name = selected.split('/').pop() || selected
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: selected,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) delMut.mutate(selected)
  }

  const allEntries = useMemo(() => listingQ.data?.entries || [], [listingQ.data?.entries])
  const hiddenCount = listingQ.data?.summary?.hidden ?? allEntries.filter(isHiddenEntry).length

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allEntries.filter((e) => {
      if (!showHidden && isHiddenEntry(e)) return false
      if (!q) return true
      return e.name.toLowerCase().includes(q)
    })
  }, [allEntries, query, showHidden])

  // Drop selection when the file leaves the visible list (e.g. hide toggled off).
  useEffect(() => {
    if (!selected) return
    const stillVisible = entries.some((e) => e.path === selected)
    if (!stillVisible) setSelected(null)
  }, [entries, selected])

  const canUp = path !== home && path.startsWith(home)

  function go(p: string) {
    const rel = p.startsWith('/') ? p.slice(1) : p
    navigate(`/files/${rel}`)
    setSelected(null)
  }

  const pathParts = path.replace(/\/+$/, '').split('/').filter(Boolean)
  const homeParts = home.replace(/\/+$/, '').split('/').filter(Boolean)
  const relativeParts =
    path.startsWith(home) && path !== home ? pathParts.slice(homeParts.length) : []

  const emptyBody =
    !showHidden && hiddenCount > 0 && !query.trim()
      ? `${hiddenCount} hidden — enable Hidden to show them.`
      : query.trim()
        ? 'Nothing matches this filter.'
        : undefined

  return (
    <div className="grid gap-3.5">
      <PageHeader
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="join">
              <Button
                variant="infoSoft"
                className="join-item"
                icon={<ArrowUp className="h-3.5 w-3.5" aria-hidden />}
                disabled={!canUp}
                onClick={() => go(parentPath(path))}
              >
                Up
              </Button>
              <Button
                variant="infoSoft"
                className="join-item"
                icon={<Home className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => go(home)}
              >
                Home
              </Button>
            </div>
            <Button
              variant={showHidden ? 'primary' : 'quiet'}
              icon={
                showHidden ? (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                )
              }
              aria-pressed={showHidden}
              onClick={() => setShowHidden((v) => !v)}
            >
              Hidden{hiddenCount > 0 ? ` · ${hiddenCount}` : ''}
            </Button>
            <Input
              className="w-44"
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter files"
            />
          </div>
        }
      >
        <nav className={`breadcrumbs text-xs ${muted} py-0 mt-1`} aria-label="Path">
          <ul className="font-mono">
            <li>
              <button type="button" className="link link-hover" onClick={() => go(home)}>
                <Home className="h-3 w-3 inline mr-1" aria-hidden />
                {home}
              </button>
            </li>
            {relativeParts.map((name, i) => {
              const built = '/' + [...homeParts, ...relativeParts.slice(0, i + 1)].join('/')
              return (
                <li key={built}>
                  <button type="button" className="link link-hover" onClick={() => go(built)}>
                    {name}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3.5 min-h-[60vh] lg:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <div className={`card ${surface} overflow-hidden section-enter min-h-[360px] flex flex-col`}>
          {listingQ.isLoading ? (
            <div className="p-4">
              <Spinner label="Loading…" />
            </div>
          ) : listingQ.isError ? (
            <div className="p-4">
              <Empty title="Could not list" body={(listingQ.error as Error).message} />
            </div>
          ) : !entries.length ? (
            <div className="p-4">
              <Empty title="Empty folder" body={emptyBody} />
            </div>
          ) : (
            <div className="overflow-auto flex-1">
              <table className="table table-sm">
                <thead className="sticky top-0 bg-base-100 z-1">
                  <tr className="border-b border-base-300">
                    <th className="font-semibold">Name</th>
                    <th className={`font-semibold w-28 text-right ${muted}`}>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const active = selected === e.path
                    const hidden = isHiddenEntry(e)
                    return (
                      <tr
                        key={e.path}
                        className={`list-row border-b border-base-300/70 last:border-0 hover:bg-primary/5 ${
                          active ? 'bg-primary/10' : ''
                        }`}
                        style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
                      >
                        <td>
                          <button
                            type="button"
                            className={`inline-flex items-center gap-2 font-medium min-w-0 max-w-full text-left rounded-btn focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                              hidden ? muted : ''
                            }`}
                            onClick={() => {
                              if (e.type === 'dir') go(e.path)
                              else setSelected(e.path)
                            }}
                          >
                            {e.type === 'dir' ? (
                              <Folder className={`h-4 w-4 ${muted} shrink-0`} aria-hidden />
                            ) : (
                              <File className={`h-4 w-4 ${muted} shrink-0`} aria-hidden />
                            )}
                            <span className="truncate">{e.name}</span>
                          </button>
                        </td>
                        <td className={`text-right tabular-nums ${muted}`}>
                          {e.type === 'dir' ? '—' : e.size_human || fmtBytes(e.size)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className={`card ${surface} section-enter min-h-[360px] flex flex-col`}>
          <div className="card-body gap-2.5 p-3.5 flex-1 min-h-0 grid grid-rows-[auto_1fr]">
            {!selected ? (
              <div className="grid place-items-center">
                <Empty
                  compact
                  icon={<Eye className="h-5 w-5" aria-hidden />}
                  title="Select a file"
                  body="Preview text files here."
                />
              </div>
            ) : previewQ.isLoading ? (
              <Spinner compact label="Loading preview…" />
            ) : previewQ.isError ? (
              <Empty compact title="Preview failed" body={(previewQ.error as Error).message} />
            ) : previewQ.data?.binary ? (
              <Empty compact title="Binary file" body="No text preview." />
            ) : previewQ.data?.error ? (
              <Empty compact title="Preview failed" body={previewQ.data.error} />
            ) : (
              <>
                <div className="flex justify-between gap-2 items-center min-w-0">
                  <strong className="text-sm truncate inline-flex items-center gap-2 min-w-0">
                    <File className={`h-4 w-4 shrink-0 ${muted}`} aria-hidden />
                    <span className="truncate">
                      {previewQ.data?.name || selected.split('/').pop()}
                    </span>
                  </strong>
                  <Button
                    variant="dangerSoft"
                    className="shrink-0"
                    icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                    loading={delMut.isPending}
                    onClick={() => void onDeleteSelected()}
                  >
                    Delete
                  </Button>
                </div>
                <pre className={`${codeSurface} min-h-0 h-full`}>{previewQ.data?.text || ''}</pre>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
