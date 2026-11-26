import { useEffect, useRef } from 'react'

type Props = {
  value: number | undefined | null
  format: (value: number) => string
}

/**
 * Odometer-style number: only the characters that changed roll in, upward when
 * the value rises and downward when it falls. The first render stays still.
 */
export function AnimatedNumber({ value, format }: Props) {
  const target = Number(value) || 0
  const text = format(target)
  const prev = useRef<{ value: number; text: string } | null>(null)
  const before = prev.current
  const dir = before && target < before.value ? 'down' : 'up'

  useEffect(() => {
    prev.current = { value: target, text }
  }, [target, text])

  const chars = text.split('')
  // Align with the previous text from the right, where digits keep their place value.
  const offset = before ? before.text.length - chars.length : 0
  return (
    <span className="roll">
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => {
        const changed = !!before && before.text[i + offset] !== ch
        return (
          <span key={`${chars.length - i}:${ch}`} className={changed ? 'roll-ch is-new' : 'roll-ch'} data-dir={dir} aria-hidden>
            {ch === ' ' ? ' ' : ch}
          </span>
        )
      })}
    </span>
  )
}
