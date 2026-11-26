import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

type Props = {
  /** Accessible name for the popup. */
  label: string
  content: ReactNode
  children: ReactNode
  align?: 'start' | 'center' | 'end'
}

const OPEN_DELAY = 110
const CLOSE_DELAY = 140
const EXIT_MS = 150

/**
 * Info popup for any element. Opens on mouse hover (with intent delay), click,
 * tap or keyboard; closes on leave, outside click or Escape. Animates in and out.
 */
export function Popover({ label, content, children, align = 'center' }: Props) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const id = useId()

  const show = () => {
    window.clearTimeout(timer.current)
    setMounted(true)
    setOpen(true)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }

  // Keep the popup mounted until its exit animation has played.
  useEffect(() => {
    if (open || !mounted) return
    const t = window.setTimeout(() => setMounted(false), EXIT_MS)
    return () => window.clearTimeout(t)
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <div
      ref={anchor}
      className="pop-anchor"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(show, OPEN_DELAY)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(hide, CLOSE_DELAY)
      }}
    >
      <button type="button" className="pop-trigger" aria-expanded={open} aria-controls={mounted ? id : undefined} onClick={() => (open ? hide() : show())}>
        {children}
      </button>
      {mounted ? (
        <div id={id} role="dialog" aria-label={label} className={`pop pop-${align}${open ? ' is-open' : ''}`}>
          {content}
        </div>
      ) : null}
    </div>
  )
}
