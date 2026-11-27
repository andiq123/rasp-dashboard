import { useState } from 'react'

type Props = {
  value: number | undefined | null
  format: (value: number) => string
}

type Snapshot = { text: string; value: number; prevText: string | null; dir: 'up' | 'down'; gen: number }

/**
 * Odometer-style number: only characters that changed move. Each changed slot
 * slides its old character out while the new one slides in (upward when the
 * value rises, downward when it falls), so nothing ever blinks empty.
 * The first render stays still.
 */
export function AnimatedNumber({ value, format }: Props) {
  const target = Number(value) || 0
  const text = format(target)
  const [snap, setSnap] = useState<Snapshot>({ text, value: target, prevText: null, dir: 'up', gen: 0 })
  let current = snap
  if (snap.text !== text) {
    current = { text, value: target, prevText: snap.text, dir: target < snap.value ? 'down' : 'up', gen: snap.gen + 1 }
    setSnap(current)
  }

  const chars = text.split('')
  // Align with the previous text from the right, where digits keep their place value.
  const offset = current.prevText ? current.prevText.length - chars.length : 0
  return (
    <span className="roll" data-dir={current.dir}>
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => {
        const old = current.prevText === null ? undefined : current.prevText[i + offset]
        const changed = current.prevText !== null && old !== ch
        const glyph = ch === ' ' ? ' ' : ch
        if (!changed) {
          // Unchanged characters keep their node (keyed by place from the right).
          return <span key={`${chars.length - i}:${ch}`} className="roll-ch" aria-hidden>{glyph}</span>
        }
        return (
          <span key={`${chars.length - i}:${ch}:${current.gen}`} className="roll-ch is-changed" aria-hidden>
            {old !== undefined ? <span className="roll-old">{old === ' ' ? ' ' : old}</span> : null}
            <span className="roll-new">{glyph}</span>
          </span>
        )
      })}
    </span>
  )
}
