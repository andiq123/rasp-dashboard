import type { ReactNode } from 'react'
import { muted } from '@/lib/ui'

type Props = {
  title: string
  children?: ReactNode
  actions?: ReactNode
}

/** Page title row — optional subtitle/breadcrumbs via children, optional trailing actions. */
export function PageHeader({ title, children, actions }: Props) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold tracking-tight m-0">{title}</h2>
        {children}
      </div>
      {actions}
    </header>
  )
}

export function PageSub({ children }: { children: ReactNode }) {
  return <p className={`text-sm ${muted} m-0 mt-1`}>{children}</p>
}
