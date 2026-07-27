import type { ReactNode } from 'react'
import { muted } from '@/lib/ui'

type Props = {
  title: string
  body?: ReactNode
  action?: ReactNode
}

export function Empty({ title, body, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-box border border-dashed border-base-300 bg-base-200/50 px-4 py-10 text-center">
      <strong className="text-sm">{title}</strong>
      {body ? <p className={`text-sm max-w-md m-0 ${muted}`}>{body}</p> : null}
      {action}
    </div>
  )
}
