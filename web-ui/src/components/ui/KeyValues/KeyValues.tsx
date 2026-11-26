import type { ReactNode } from 'react'

export type KeyValue = { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'warn' }

export function KeyValues({ items }: { items: KeyValue[] }) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.tone ? `tone-${item.tone}` : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
