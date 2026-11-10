import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, Check, Copy, TriangleAlert, WrapText } from 'lucide-react'
import { writeClipboardText } from '@/lib/clipboard'
import type { LogLineView } from '@/lib/logLines'

type Props = {
  lines: LogLineView[]
  live?: boolean
  /** Short description shown at the left of the toolbar. */
  title?: ReactNode
  className?: string
  empty?: ReactNode
  /** Following restarts from the bottom when this changes. */
  stickKey?: string
}

const Line = memo(function Line({ line }: { line: LogLineView }) {
  return (
    <div className={`log-line log-${line.level}`}>
      {line.at ? <span className="log-time">{line.at}</span> : null}
      <span className="log-text">{line.text}</span>
    </div>
  )
})

/**
 * Terminal-style log pane: always dark, follows the tail while you stay at the
 * bottom, and stops following the moment you scroll up to read.
 */
export function LogConsole({ lines, live, title, className = '', empty, stickKey }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [following, setFollowing] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [copied, setCopied] = useState(false)

  const issueCount = useMemo(
    () => lines.reduce((n, l) => (l.level === 'err' || l.level === 'warn' ? n + 1 : n), 0),
    [lines],
  )
  const shown = useMemo(
    () => (issuesOnly ? lines.filter((l) => l.level === 'err' || l.level === 'warn') : lines),
    [lines, issuesOnly],
  )

  function setFollow(next: boolean) {
    follow.current = next
    setFollowing(next)
  }

  function toBottom() {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useEffect(() => setFollow(true), [stickKey])

  useLayoutEffect(() => {
    if (follow.current) toBottom()
  }, [shown, wrap, stickKey])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(t)
  }, [copied])

  if (!lines.length) return <>{empty}</>

  async function copyAll() {
    try {
      await writeClipboardText(shown.map((l) => (l.at ? `${l.at} ${l.text}` : l.text)).join('\n'))
      setCopied(true)
    } catch {
      /* clipboard blocked: the text stays selectable */
    }
  }

  return (
    <div data-theme="fw-dark" className={`log-shell ${className}`}>
      <div className="log-bar">
        <span className="flex items-center gap-2 min-w-0 mr-auto">
          {live ? <span className="log-pulse shrink-0" aria-hidden /> : null}
          <span className="truncate font-medium opacity-80">{title || (live ? 'Live output' : 'Output')}</span>
          <span className="font-mono tabular-nums opacity-50 shrink-0">{shown.length} lines</span>
        </span>
        {issueCount ? (
          <button
            type="button"
            className="log-tool"
            aria-pressed={issuesOnly}
            title="Show only warnings and errors"
            onClick={() => setIssuesOnly((v) => !v)}
          >
            <TriangleAlert size={13} aria-hidden />
            {issueCount}
          </button>
        ) : null}
        <button type="button" className="log-tool" aria-pressed={wrap} title="Wrap long lines" aria-label="Wrap long lines" onClick={() => setWrap((v) => !v)}>
          <WrapText size={13} aria-hidden />
        </button>
        <button type="button" className="log-tool" title="Copy log" aria-label="Copy log" onClick={() => void copyAll()}>
          {copied ? <Check size={13} className="text-success" aria-hidden /> : <Copy size={13} aria-hidden />}
        </button>
      </div>
      <div
        ref={bodyRef}
        role="log"
        aria-live={live ? 'polite' : 'off'}
        tabIndex={0}
        className={`log-body ${wrap ? 'log-wrap' : ''}`}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
          if (atBottom !== follow.current) setFollow(atBottom)
        }}
      >
        {shown.length ? (
          shown.map((l) => <Line key={l.key} line={l} />)
        ) : (
          <p className="m-0 px-3 py-6 text-center opacity-60 font-sans">No warnings or errors.</p>
        )}
        {!following ? (
          <button type="button" className="log-jump" onClick={() => { setFollow(true); toBottom() }}>
            <ArrowDown size={13} aria-hidden />
            {live ? 'Follow live output' : 'Jump to end'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
