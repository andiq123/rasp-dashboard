import type { ReactNode } from 'react'
import { muted, surface } from '@/lib/ui'

type Props = {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  /** Softer enter when the page mounts / section switches. */
  animate?: boolean
  busy?: boolean
}

export function Panel({ title, hint, children, className = '', id, animate = true, busy }: Props) {
  return (
    <section
      id={id}
      className={`card ${surface} ${animate ? 'section-enter' : ''} ${className}`}
      aria-busy={busy || undefined}
    >
      <div className="card-body gap-3 p-3 sm:p-4">
        {(title || hint) && (
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="card-title text-sm tracking-tight m-0">{title}</h2>
            {hint ? (
              <span className={`text-[11px] font-medium ${muted}`}>{hint}</span>
            ) : null}
          </div>
        )}
        {children}
      </div>
    </section>
  )
}
