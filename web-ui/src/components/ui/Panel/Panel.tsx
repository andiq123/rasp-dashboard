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
      <div className="card-body gap-4 p-4 sm:p-5">
        {(title || hint) && (
          <div className="panel-heading flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title text-base tracking-tight m-0">{title}</h2>
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
