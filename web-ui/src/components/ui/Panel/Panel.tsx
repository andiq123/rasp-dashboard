import type { ReactNode } from 'react'
import { muted, surface } from '@/lib/ui'

type Props = {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}

export function Panel({ title, hint, children, className = '', id }: Props) {
  return (
    <section id={id} className={`card ${surface} ${className}`}>
      <div className="card-body gap-4 p-4 sm:p-5">
        {(title || hint) && (
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="card-title text-base tracking-tight m-0">{title}</h2>
            {hint ? <span className={`text-xs ${muted}`}>{hint}</span> : null}
          </div>
        )}
        {children}
      </div>
    </section>
  )
}
