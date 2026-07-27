import { useEffect, useId, useRef, type ReactNode } from 'react'
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

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={`modal ${open ? 'modal-open' : ''}`}
      onClose={onClose}
      aria-labelledby={titleId}
    >
      <div className={`modal-box ${size === 'md' ? 'max-w-3xl' : 'max-w-md'}`}>
        <h3 id={titleId} className="font-bold text-lg tracking-tight">
          {title}
        </h3>
        {sub ? <p className={`text-sm mt-1 ${muted}`}>{sub}</p> : null}
        {children != null && children !== false ? (
          <div className="mt-4 grid gap-3">{children}</div>
        ) : null}
        {footer ? <div className="modal-action flex-wrap">{footer}</div> : null}
      </div>
      <form method="dialog" className="modal-backdrop bg-base-content/20">
        <button type="submit">close</button>
      </form>
    </dialog>
  )
}
