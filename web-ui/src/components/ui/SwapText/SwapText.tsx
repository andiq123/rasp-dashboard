import { useEffect, useRef } from 'react'

type Props = { children: string; className?: string }

/** Text that slides in softly when its content changes; the first render stays still. */
export function SwapText({ children, className = '' }: Props) {
  const prev = useRef<string | null>(null)
  const changed = prev.current !== null && prev.current !== children
  useEffect(() => {
    prev.current = children
  }, [children])
  return (
    <span key={children} className={`swap-text${changed ? ' is-new' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </span>
  )
}
