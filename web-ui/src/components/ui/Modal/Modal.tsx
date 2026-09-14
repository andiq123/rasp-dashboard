import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { muted } from '@/lib/ui'

type Props = {
  open: boolean
  title: string
  sub?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md'
}

export function Modal({ open, title, sub, onClose, children, footer, size = 'sm' }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Keep the native dialog state in the same visual commit as React state.
  // A passive effect leaves the old modal painted for a frame after Create.
  useLayoutEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={`modal z-[200] ${open ? 'modal-open' : ''}`}
      // Closing one wizard dialog programmatically must not cancel the next step.
      onClose={() => {
        if (open) onClose()
      }}
      aria-labelledby={titleId}
    >
      <div className={`modal-box ${size === 'md' ? 'max-w-3xl' : 'max-w-md'}`}>
        <h3 id={titleId} className="font-bold text-lg tracking-tight pr-8">
          {title}
        </h3>
        {sub ? <p className={`text-sm mt-1 ${muted}`}>{sub}</p> : null}
        {children != null && children !== false ? (
          <div className="mt-4 grid gap-3">{children}</div>
        ) : null}
        {footer ? <div className="modal-action flex-wrap">{footer}</div> : null}
        <button type="button" className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" aria-label="Close dialog" onClick={onClose}><X size={18} aria-hidden /></button>
      </div>
      <form method="dialog" className="modal-backdrop bg-base-content/20">
        <button type="submit">close</button>
      </form>
    </dialog>
  )
}
