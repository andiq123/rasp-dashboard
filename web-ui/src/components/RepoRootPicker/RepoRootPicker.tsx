import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Check, ChevronRight, FolderOpen, House, Package, Sparkles } from 'lucide-react'
import { fetchDirs } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { PanelSkeleton } from '@/components/ui/Skeleton/Skeleton'

type Props = {
  repo: string
  branch: string
  value: string
  onChange: (path: string) => void
  disabled?: boolean
}

function parentOf(path: string): string {
  const p = path.replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  return i <= 0 ? '' : p.slice(0, i)
}

function crumbs(path: string): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = []
  let acc = ''
  for (const part of path.split('/').filter(Boolean)) {
    acc = acc ? `${acc}/${part}` : part
    out.push({ label: part, path: acc })
  }
  return out
}

const label = (path: string) => path || 'repo root'

/** Browse the repo on GitHub and pick the folder with go.mod; detected modules are one tap. */
export function RepoRootPicker({ repo, branch, value, onChange, disabled }: Props) {
  const [browse, setBrowse] = useState(value || '')
  // Reset browsing when the repo, branch or saved value changes (adjust during render).
  const resetKey = `${repo}|${branch}|${value}`
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setBrowse(value || '')
  }

  const dirsQ = useQuery({
    queryKey: queryKeys.githubDirs(repo, branch, browse),
    queryFn: () => fetchDirs(repo, branch, browse),
    enabled: !!repo && !!branch && !disabled,
  })
  const modules = dirsQ.data?.go_modules || []
  const dirs = dirsQ.data?.dirs || []
  const suggested = dirsQ.data?.suggested_root || ''
  const isModule = (path: string) => modules.some((m) => m.path === path)
  const chosen = value === browse

  if (!repo || !branch) {
    return <Empty compact title="Pick a repo and branch first" body="Then browse folders for go.mod." />
  }

  return (
    <div className="picker">
      <div className="picker-bar">
        <nav className="picker-crumbs" aria-label="Folder path">
          <button type="button" className={browse === '' ? 'is-here' : undefined} disabled={disabled} onClick={() => setBrowse('')} title="Repo root">
            <House aria-hidden /><span className="sr-only">Repo root</span>
          </button>
          {crumbs(browse).map((c) => (
            <span key={c.path} className="picker-crumb">
              <ChevronRight aria-hidden />
              <button type="button" className={c.path === browse ? 'is-here' : undefined} disabled={disabled} onClick={() => setBrowse(c.path)}>{c.label}</button>
            </span>
          ))}
        </nav>
        {browse ? (
          <Button variant="quiet" icon={<ArrowUp className="h-3.5 w-3.5" aria-hidden />} disabled={disabled} onClick={() => setBrowse(parentOf(browse))} aria-label="Up one folder" title="Up one folder" />
        ) : null}
      </div>

      <div className="picker-choice">
        {chosen ? (
          <span className="picker-chosen"><Check aria-hidden />Root: {label(value)}</span>
        ) : (
          <>
            <Button variant="primary" icon={<Check className="h-3.5 w-3.5" aria-hidden />} disabled={disabled} onClick={() => onChange(browse)}>
              Use {label(browse)}
            </Button>
            <span className="picker-note">Now: {label(value)}</span>
          </>
        )}
      </div>

      {!browse && modules.length ? (
        <div className="picker-modules" aria-label="Go modules found">
          {modules.map((m) => (
            <button
              key={m.path}
              type="button"
              className={`picker-module${value === m.path ? ' is-on' : ''}`}
              disabled={disabled}
              onClick={() => {
                setBrowse(m.path)
                onChange(m.path)
              }}
            >
              <Package aria-hidden />{label(m.path)}
              {suggested === m.path ? <em><Sparkles aria-hidden />Suggested</em> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div key={browse} className="picker-list">
        {dirsQ.isLoading ? (
          <div className="p-2"><PanelSkeleton rows={2} label="Reading folders" /></div>
        ) : dirsQ.isError ? (
          <Empty compact title="Could not list folders" body={(dirsQ.error as Error).message} />
        ) : !dirs.length ? (
          <p className="picker-empty">No subfolders here.</p>
        ) : (
          <ul>
            {dirs.map((d) => (
              <li key={d.path}>
                <button type="button" disabled={disabled} onClick={() => setBrowse(d.path)}>
                  <FolderOpen aria-hidden />
                  <span className="truncate">{d.name}</span>
                  {isModule(d.path) ? <em>go.mod</em> : null}
                  <ChevronRight className="picker-go" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
