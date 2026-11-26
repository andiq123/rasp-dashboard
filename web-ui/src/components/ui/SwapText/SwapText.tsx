import { useLayoutEffect, useRef, useState } from 'react'

type Props = { children: string; className?: string }

/** Text that slides in softly when its content changes; the first render stays still. */
export function SwapText({ children, className = '' }: Props) {
  const [shown, setShown] = useState(children)
  const [changed, setChanged] = useState(false)
  if (shown !== children) {
    // React's "store the previous value" pattern: adjust state during render.
    setShown(children)
    setChanged(true)
  }
  return (
    <span key={children} className={`swap-text${changed ? ' is-new' : ''}${className ? ` ${className}` : ''}`}>
      {children}
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
