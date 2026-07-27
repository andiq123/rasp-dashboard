import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchFilePreview, fetchFiles, filesOp, readInitialState } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { Input } from '@/components/ui/Field/Field'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { useToast } from '@/components/ui/Toast/Toast'
import { fmtBytes } from '@/lib/format'
import styles from './FilesPage.module.css'

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
      showToast('Deleted')
      setSelected(null)
      await qc.invalidateQueries({ queryKey: queryKeys.files(path) })
    },
    onError: (e: Error) => showToast(e.message),
  })

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

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h2>Files</h2>
          <p className="ghost mono">{path}</p>
        </div>
        <div className={styles.tools}>
          <Button variant="quiet" disabled={!canUp} onClick={() => go(parentPath(path))}>
            Up
          </Button>
          <Button variant="quiet" onClick={() => go(home)}>
            Home
          </Button>
          <label className={styles.check}>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Hidden
          </label>
          <Input
            className={styles.search}
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <div className={styles.split}>
        <div className={styles.listPane}>
          {listingQ.isLoading ? (
            <Spinner label="Loading…" />
          ) : listingQ.isError ? (
            <Empty title="Could not list" body={(listingQ.error as Error).message} />
          ) : !entries.length ? (
            <Empty title="Empty folder" />
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.path}
                    className={selected === e.path ? styles.selected : undefined}
                    onClick={() => {
                      if (e.type === 'dir') go(e.path)
                      else setSelected(e.path)
                    }}
                    onDoubleClick={() => {
                      if (e.type === 'dir') go(e.path)
                    }}
                  >
                    <td>
                      <span className={styles.name}>
                        {e.type === 'dir' ? '[dir] ' : ''}
                        {e.name}
                      </span>
                    </td>
                    <td className="ghost">{e.type === 'dir' ? '—' : e.size_human || fmtBytes(e.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <aside className={styles.preview}>
          {!selected ? (
            <Empty title="Select a file" body="Preview text files here." />
          ) : previewQ.isLoading ? (
            <Spinner label="Loading preview…" />
          ) : previewQ.data?.binary ? (
            <Empty title="Binary file" body="No text preview." />
          ) : previewQ.data?.error ? (
            <Empty title="Preview failed" body={previewQ.data.error} />
          ) : (
            <>
              <div className={styles.previewHead}>
                <strong>{previewQ.data?.name || selected.split('/').pop()}</strong>
                <Button
                  variant="dangerSoft"
                  loading={delMut.isPending}
                  onClick={() => {
                    if (selected && confirm(`Delete ${selected}?`)) delMut.mutate(selected)
                  }}
                >
                  Delete
                </Button>
              </div>
              <pre className={styles.code}>{previewQ.data?.text || ''}</pre>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}