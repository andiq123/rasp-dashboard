import { Loader2 } from 'lucide-react'
import { muted } from '@/lib/ui'

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 p-8 ${muted}`} role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm m-0">{label}</p>
    </div>
  )
}
