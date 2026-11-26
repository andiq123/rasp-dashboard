import { useState } from 'react'

type Props = {
  value: number | undefined | null
  format: (value: number) => string
}

type Snapshot = { text: string; value: number; prevText: string | null; dir: 'up' | 'down' }

/**
 * Odometer-style number: only the characters that changed roll in, upward when
 * the value rises and downward when it falls. The first render stays still.
 */
export function AnimatedNumber({ value, format }: Props) {
  const target = Number(value) || 0
  const text = format(target)
  const [snap, setSnap] = useState<Snapshot>({ text, value: target, prevText: null, dir: 'up' })
  let current = snap
  if (snap.text !== text) {
    current = { text, value: target, prevText: snap.text, dir: target < snap.value ? 'down' : 'up' }
    setSnap(current)
  }

  const chars = text.split('')
  // Align with the previous text from the right, where digits keep their place value.
  const offset = current.prevText ? current.prevText.length - chars.length : 0
  return (
    <span className="roll">
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => {
        const changed = current.prevText !== null && current.prevText[i + offset] !== ch
        return (
          // Keyed by position from the right + character: unchanged digits keep their node.
          <span key={`${chars.length - i}:${ch}`} className={changed ? 'roll-ch is-new' : 'roll-ch'} data-dir={current.dir} aria-hidden>
            {ch === ' ' ? ' ' : ch}
          </span>
        )
      })}
    </span>
  )
}
