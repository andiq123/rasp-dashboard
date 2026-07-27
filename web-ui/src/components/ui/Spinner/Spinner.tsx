import { Loader2 } from 'lucide-react'
import { muted } from '@/lib/ui'

export function Spinner({
  label = 'Loading…',
  compact,
}: {
  label?: string
  compact?: boolean
}) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-2',
        compact ? 'p-4' : 'p-6',
        muted,
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      <Loader2
        className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} animate-spin text-primary`}
        aria-hidden
      />
      <p className={`m-0 ${compact ? 'text-xs' : 'text-sm'}`}>{label}</p>
    </div>
  )
}
