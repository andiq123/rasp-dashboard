import { useEffect, useState, type ReactNode } from 'react'

const EXIT_MS = 240

type Entry<T> = { key: string; item: T; leaving: boolean }

type Props<T> = {
  items: T[]
  getKey: (item: T) => string
  render: (item: T) => ReactNode
  className?: string
  /** Stack items in one place and crossfade (for swapping one thing for another). */
  swap?: boolean
}

/**
 * Renders a keyed list whose items animate in and out: new items rise in,
 * removed items fade and collapse before they unmount. Layout never jumps.
 */
export function AnimatedList<T>({ items, getKey, render, className = '', swap = false }: Props<T>) {
  const keys = items.map(getKey).join('\u0000')
  const [entries, setEntries] = useState<Entry<T>[]>(() => items.map((item) => ({ key: getKey(item), item, leaving: false })))
  const [seenKeys, setSeenKeys] = useState(keys)

  if (keys !== seenKeys) {
    // Merge during render: keep order, mark vanished items as leaving.
    const live = new Map(items.map((item) => [getKey(item), item]))
    const merged: Entry<T>[] = entries.map((e) => (live.has(e.key) ? { ...e, item: live.get(e.key) as T, leaving: false } : { ...e, leaving: true }))
    for (const item of items) {
      const key = getKey(item)
      if (!merged.some((e) => e.key === key)) merged.push({ key, item, leaving: false })
    }
    setSeenKeys(keys)
    setEntries(merged)
  }

  const anyLeaving = entries.some((e) => e.leaving)
  useEffect(() => {
    if (!anyLeaving) return
    const timer = window.setTimeout(() => setEntries((list) => list.filter((e) => !e.leaving)), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [anyLeaving])

  if (!entries.length) return null
  const live = new Map(items.map((item) => [getKey(item), item]))
  return (
    <div className={`anim-list${swap ? ' anim-swap' : ''} ${className}`}>
      {entries.map((e) => (
        <div key={e.key} className={`anim-item${e.leaving ? ' is-leaving' : ''}`} aria-hidden={e.leaving || undefined}>
          <div className="anim-item-inner">{render(live.get(e.key) ?? e.item)}</div>
        </div>
      ))}
    </div>
  )
}
