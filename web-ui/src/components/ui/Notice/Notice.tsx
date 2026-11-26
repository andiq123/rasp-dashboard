import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Props = {
  icon: LucideIcon
  tone: 'ok' | 'warn' | 'bad' | 'busy'
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}

/** Inline status message; the tone tints the surface and the icon. */
export function Notice({ icon: Icon, tone, title, children, action }: Props) {
  return (
    <div className={`notice tone-${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <div className="min-w-0 flex-1">
        <strong className="block font-semibold">{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
      {action}
    </div>
  )
}
