import { useLayoutEffect, useRef, useState } from 'react'

type Props = { children: string; className?: string }

type Swap = { text: string; prev: string | null; gen: number }

/** Length of the shared start and end of two strings (never overlapping). */
function sharedEnds(a: string, b: string): [number, number] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  return [start, end]
}

/**
 * Text that changes in place: only the part that differs fades up
 * ("3 running" → "4 running" moves just the digit). The first render stays still.
 */
export function SwapText({ children, className = '' }: Props) {
  const [swap, setSwap] = useState<Swap>({ text: children, prev: null, gen: 0 })
  let current = swap
  if (swap.text !== children) {
    // React's "store the previous value" pattern: adjust state during render.
    current = { text: children, prev: swap.text, gen: swap.gen + 1 }
    setSwap(current)
  }
  const cls = `swap-text${className ? ` ${className}` : ''}`
  if (current.prev === null) return <span className={cls}>{children}</span>
  const [start, end] = sharedEnds(current.prev, children)
  return (
    <span className={cls}>
      {children.slice(0, start)}
      <span key={current.gen} className="swap-mid">{children.slice(start, children.length - end)}</span>
      {children.slice(children.length - end)}
    </span>
  )
}

/**
 * Block of text whose height animates to fit new content, so surrounding layout
 * glides instead of jumping when a line gets longer or shorter.
 */
export function SwapBlock({ children, className = '' }: Props) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className={`swap-block ${className}`} style={{ height }}>
      <div ref={inner}>
        <SwapText>{children}</SwapText>
      </div>
    </div>
  )
}
