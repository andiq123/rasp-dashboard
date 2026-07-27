import type { ReactNode } from 'react'
import { muted } from '@/lib/ui'

type Props = {
  title: string
  body?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
}

export function Empty({ title, body, action, icon, compact }: Props) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-2 rounded-box border border-dashed border-base-300 bg-base-200/40 text-center',
        compact ? 'px-3 py-5' : 'px-4 py-8',
      ].join(' ')}
    >
      {icon ? <div className={`${muted} opacity-80`}>{icon}</div> : null}
      <strong className={`m-0 ${compact ? 'text-xs' : 'text-sm'}`}>{title}</strong>
      {body ? <p className={`max-w-md m-0 ${compact ? 'text-xs' : 'text-sm'} ${muted}`}>{body}</p> : null}
      {action}
    </div>
  )
}
