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
    <header className="page-header flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {title ? <h1 className="text-3xl font-semibold tracking-tight m-0 mb-2">{title}</h1> : null}
        {children}
      </div>
      {actions}
    </header>
  )
}

export function PageSub({ children }: { children: ReactNode }) {
  return <p className={`text-sm ${muted} m-0`}>{children}</p>
}
