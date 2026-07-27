import type { ReactNode } from 'react'
import { muted } from '@/lib/ui'

type Props = {
  /** Omit when the shell topbar already shows the section name. */
  title?: string
  children?: ReactNode
  actions?: ReactNode
}

/** Page toolbar — optional title, subtitle/breadcrumbs via children, trailing actions. */
export function PageHeader({ title, children, actions }: Props) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-1">
      <div className="min-w-0">
        {title ? <h2 className="text-xl font-bold tracking-tight m-0">{title}</h2> : null}
        {children}
      </div>
      {actions}
    </header>
  )
}

export function PageSub({ children }: { children: ReactNode }) {
  return <p className={`text-sm ${muted} m-0`}>{children}</p>
}
