import { useState } from 'react'

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
