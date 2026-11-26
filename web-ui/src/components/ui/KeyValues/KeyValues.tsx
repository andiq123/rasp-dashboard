import type { ReactNode } from 'react'
import { SwapText } from '@/components/ui/SwapText/SwapText'

export type KeyValue = { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'warn' }

export function KeyValues({ items }: { items: KeyValue[] }) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.tone ? `tone-${item.tone}` : undefined}>
            {typeof item.value === 'string' ? <SwapText>{item.value}</SwapText> : item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
