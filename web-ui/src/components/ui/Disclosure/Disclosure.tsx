import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { SwapText } from '@/components/ui/SwapText/SwapText'

type Props = {
  /** Stable key; the open state is remembered per browser. */
  id: string
  title: string
  icon?: LucideIcon
  /** Short value shown on the closed row, so it is useful without opening. */
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

const storageKey = (id: string) => `fw.disclosure.${id}`

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(storageKey(id))
    return v == null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/**
 * Secondary detail behind one row. Children mount lazily on first open and stay
 * mounted, so every open and close animates (height via grid rows, body fades).
 */
export function Disclosure({ id, title, icon: Icon, summary, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen))
  const [mounted, setMounted] = useState(open)
  const [opening, setOpening] = useState(false)
  const regionId = useId()

  // First open: render the content collapsed for one frame, then expand, so the
  // transition has real content to animate instead of jumping to full height.
  useEffect(() => {
    if (!opening) return
    const frame = requestAnimationFrame(() => {
      setOpen(true)
      setOpening(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [opening])

  function toggle() {
    const next = !open
    if (next && !mounted) {
      setMounted(true)
      setOpening(true)
    } else {
      setOpen(next)
    }
    try {
      localStorage.setItem(storageKey(id), next ? '1' : '0')
    } catch {
      /* private mode: state lasts for this page only */
    }
  }

  return (
    <div className="disclosure" data-open={open}>
      <button type="button" className="disclosure-trigger" aria-expanded={open || opening} aria-controls={regionId} onClick={toggle}>
        {Icon ? <Icon aria-hidden /> : null}
        <span>{title}</span>
        <span className="disclosure-summary" aria-hidden={open}>
          {typeof summary === 'string' ? <SwapText>{summary}</SwapText> : summary}
        </span>
        <ChevronRight className="disclosure-chevron" aria-hidden />
      </button>
      <div id={regionId} className="disclosure-region" role="region" aria-label={title}>
        <div className="disclosure-inner" inert={!open}>
          <div className="disclosure-body">{mounted ? children : null}</div>
        </div>
      </div>
    </div>
  )
}
