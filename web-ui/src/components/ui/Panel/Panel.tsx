import type { ReactNode } from 'react'
import { muted, surface } from '@/lib/ui'

type Props = {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  busy?: boolean
}

export function Panel({ title, hint, children, className = '', id, busy }: Props) {
  return (
    <section
      id={id}
      className={`card ${surface} ${className}`}
      aria-busy={busy || undefined}
    >
      <div className="card-body gap-3.5 p-3.5 sm:p-4">
        {(title || hint) && (
          <div className="panel-heading flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title text-sm font-semibold m-0">{title}</h2>
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
