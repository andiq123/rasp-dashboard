import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react'
import { fetchDirs } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { muted, tile } from '@/lib/ui'

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
  if (i <= 0) return ''
  return p.slice(0, i)
}

function crumbs(path: string): Array<{ label: string; path: string }> {
  const parts = path.split('/').filter(Boolean)
  const out: Array<{ label: string; path: string }> = [{ label: 'repo root', path: '' }]
  let acc = ''
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part
    out.push({ label: part, path: acc })
  }
  return out
}

/** Navigable GitHub directory picker for service root_dir. */
export function RepoRootPicker({ repo, branch, value, onChange, disabled }: Props) {
  const [browse, setBrowse] = useState(value || '')

  useEffect(() => {
    setBrowse(value || '')
  }, [repo, branch, value])

  const dirsQ = useQuery({
    queryKey: queryKeys.githubDirs(repo, branch, browse),
    queryFn: () => fetchDirs(repo, branch, browse),
    enabled: !!repo && !!branch && !disabled,
  })

  const modules = dirsQ.data?.go_modules || []
  const dirs = dirsQ.data?.dirs || []
  const suggested = dirsQ.data?.suggested_root || ''

  if (!repo || !branch) {
    return (
      <Empty compact title="Pick a repo and branch first" body="Then browse folders for go.mod." />
    )
  }

  return (
    <div className={`${tile} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-1 px-2.5 py-2 border-b border-base-300 bg-base-100/70">
        {crumbs(browse).map((c, i) => (
          <span key={c.path || 'root'} className="inline-flex items-center gap-1 min-w-0">
            {i > 0 ? <ChevronRight className={`h-3 w-3 shrink-0 ${muted}`} aria-hidden /> : null}
            <button
              type="button"
              className={`text-xs font-semibold truncate max-w-[9rem] ${
                c.path === browse ? 'text-primary' : muted
              } hover:text-primary`}
              disabled={disabled}
              onClick={() => setBrowse(c.path)}
            >
              {c.label}
            </button>
          </span>
        ))}
        {browse ? (
          <Button
            variant="quiet"
            className="ml-auto"
            disabled={disabled}
            onClick={() => setBrowse(parentOf(browse))}
          >
            Up
          </Button>
        ) : null}
      </div>

      <div className="px-2.5 py-2 flex flex-wrap gap-1.5 border-b border-base-300">
        <Button
          variant={value === browse ? 'primary' : 'quiet'}
          disabled={disabled}
          onClick={() => onChange(browse)}
        >
          Use {browse ? browse : 'repo root'}
        </Button>
        {value !== browse ? (
          <span className={`text-[11px] self-center ${muted}`}>
            Selected: {value || '(repo root)'}
          </span>
        ) : (
          <span className={`text-[11px] self-center text-success`}>Selected</span>
        )}
      </div>

      {!browse && modules.length ? (
        <div className="px-2.5 py-2 border-b border-base-300 grid gap-1">
          <span className={`text-[11px] font-bold uppercase tracking-wide ${muted}`}>go.mod found</span>
          <div className="flex flex-wrap gap-1">
            <Button
              variant={!value ? 'primary' : 'quiet'}
              disabled={disabled}
              onClick={() => {
                setBrowse('')
                onChange('')
              }}
            >
              /
            </Button>
            {modules.map((m) => (
              <Button
                key={m.path}
                variant={value === m.path ? 'primary' : 'quiet'}
                disabled={disabled}
                onClick={() => {
                  setBrowse(m.path)
                  onChange(m.path)
                }}
              >
                {m.path}
                {suggested === m.path ? ' · suggested' : ''}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-h-48 overflow-auto">
        {dirsQ.isLoading ? (
          <div className={`flex items-center gap-2 px-3 py-4 text-xs ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading folders…
          </div>
        ) : dirsQ.isError ? (
          <Empty compact title="Could not list folders" body={(dirsQ.error as Error).message} />
        ) : !dirs.length ? (
          <Empty
            compact
            icon={<Folder className="h-5 w-5" aria-hidden />}
            title="No subfolders"
            body="Use this path as the service root, or go up."
          />
        ) : (
          <ul className="list-none m-0 p-0">
            {dirs.map((d) => (
              <li key={d.path}>
                <button
                  type="button"
                  disabled={disabled}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-primary/5 transition-colors duration-200 border-b border-base-300/60 last:border-0"
                  onClick={() => setBrowse(d.path)}
                >
                  <FolderOpen className={`h-4 w-4 shrink-0 ${muted}`} aria-hidden />
                  <span className="truncate font-medium">{d.name}</span>
                  <span className={`ml-auto text-[11px] font-mono truncate max-w-[40%] ${muted}`}>{d.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
