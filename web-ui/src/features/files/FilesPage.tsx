import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Eye, File, Folder, Home, Trash2 } from 'lucide-react'
import { fetchFilePreview, fetchFiles, filesOp, readInitialState } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
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

  const entries = useMemo(() => {
    const list = listingQ.data?.entries || []
    return list.filter((e) => {
      if (!showHidden && e.hidden) return false
      if (!query.trim()) return true
      return e.name.toLowerCase().includes(query.trim().toLowerCase())
    })
  }, [listingQ.data, query, showHidden])

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

  return (
    <div className="grid gap-3">
      <PageHeader
        actions={
          <div className="join join-horizontal flex-wrap items-center gap-1.5">
            <Button
              variant="infoSoft"
              icon={<ArrowUp className="h-3.5 w-3.5" aria-hidden />}
              disabled={!canUp}
              onClick={() => go(parentPath(path))}
            >
              Up
            </Button>
            <Button
              variant="infoSoft"
              icon={<Home className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => go(home)}
            >
              Home
            </Button>
            <label className="label cursor-pointer gap-1.5 px-2 py-0">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              <span className={`label-text text-xs font-semibold ${muted} inline-flex items-center gap-1`}>
                <Eye className="h-3 w-3" aria-hidden />
                Hidden
              </span>
            </label>
            <Input
              className="w-40 join-item"
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
      >
        <div className={`breadcrumbs text-xs ${muted} py-0 mt-1`}>
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
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 min-h-[60vh] lg:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]">
        <div className={`card ${surface} overflow-auto min-h-[360px]`}>
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
              <Empty title="Empty folder" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
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
                        if (e.type === 'dir') go(e.path)
                        else setSelected(e.path)
                      }}
                      onDoubleClick={() => {
                        if (e.type === 'dir') go(e.path)
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
                      <td className={`${muted}`}>
                        {e.type === 'dir' ? '—' : e.size_human || fmtBytes(e.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <aside className={`card ${surface} min-h-[360px]`}>
          <div className="card-body gap-2.5 p-3 grid grid-rows-[auto_1fr]">
            {!selected ? (
              <Empty
                compact
                icon={<Eye className="h-5 w-5" aria-hidden />}
                title="Select a file"
                body="Preview text files here."
              />
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
                <div className="flex justify-between gap-2 items-center">
                  <strong className="text-sm truncate inline-flex items-center gap-2">
                    <File className={`h-4 w-4 shrink-0 ${muted}`} aria-hidden />
                    {previewQ.data?.name || selected.split('/').pop()}
                  </strong>
                  <Button
                    variant="dangerSoft"
                    icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                    loading={delMut.isPending}
                    onClick={() => void onDeleteSelected()}
                  >
                    Delete
                  </Button>
                </div>
                <pre className={codeSurface}>{previewQ.data?.text || ''}</pre>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
