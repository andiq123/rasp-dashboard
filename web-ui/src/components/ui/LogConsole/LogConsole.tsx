import { useEffect, useRef, type ReactNode, type UIEvent } from 'react'
import { codeSurface } from '@/lib/ui'
import { logLevelClass, type LogLineView } from '@/lib/logLines'

type Props = {
  lines: LogLineView[]
  live?: boolean
  className?: string
  empty?: ReactNode
  /** Scroll stick key — reset stick-to-bottom when this changes. */
  stickKey?: string
}

/**
 * Monospace log pane with per-level colors (info / warn / err / ok / …).
 * Sticks to bottom while the user is near the end.
 */
export function LogConsole({ lines, live, className = '', empty, stickKey }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  useEffect(() => {
    stickRef.current = true
  }, [stickKey])

  useEffect(() => {
    const el = ref.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  if (!lines.length) {
    return <>{empty}</>
  }

  return (
    <div
      ref={ref}
      role="log"
      aria-live={live ? 'polite' : undefined}
      className={`${codeSurface} font-mono text-xs leading-relaxed overflow-auto ${
        live ? 'console-live' : ''
      } ${className}`}
      onScroll={onScroll}
    >
      {lines.map((l) => {
        const showTag =
          !!l.level &&
          l.level !== 'out' &&
          !l.text.startsWith('[') &&
          !/\b(?:level|lvl)=/i.test(l.text)
        return (
          <div key={l.key} className={`whitespace-pre-wrap break-words ${logLevelClass(l.level)}`}>
            {l.at ? <span className="text-base-content/40 mr-1.5">{l.at}</span> : null}
            {showTag ? <span className="opacity-70 mr-1">[{l.level}]</span> : null}
            {l.text}
          </div>
        )
      })}
    </div>
  )
}
