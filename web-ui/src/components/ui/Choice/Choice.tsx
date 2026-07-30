import type { ReactNode } from 'react'
import { choice, iconWell, muted } from '@/lib/ui'

type Props = {
  title: string
  description: string
  icon: ReactNode
  tone?: 'primary' | 'success' | 'warning' | 'info' | 'error'
  onClick: () => void
}

export function Choice({ title, description, icon, tone = 'primary', onClick }: Props) {
  return (
    <button type="button" className={choice} onClick={onClick}>
      <span className={iconWell(tone)}>{icon}</span>
      <span>
        <strong className="block">{title}</strong>
        <span className={`block text-sm ${muted} mt-0.5`}>{description}</span>
      </span>
    </button>
  )
}
