import { useEffect, useRef, useState } from 'react'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const easeOut = (t: number) => 1 - (1 - t) ** 3

/** Eases from the previous value to the new one; the first value shows as-is. */
export function useTween(value: number, duration = 600): number {
  const target = Number.isFinite(value) ? value : 0
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)

  useEffect(() => {
    const from = shownRef.current
    if (from === target || reducedMotion() || document.hidden) {
      shownRef.current = target
      setShown(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const v = from + (target - from) * easeOut(t)
      shownRef.current = v
      setShown(v)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return shown
}

type Props = {
  value: number | undefined | null
  format: (value: number) => string
  duration?: number
}

/** A number that glides to each new value. Screen readers get the final value only. */
export function AnimatedNumber({ value, format, duration }: Props) {
  const target = Number(value) || 0
  const shown = useTween(target, duration)
  return (
    <span className="tabular-nums">
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(target)}</span>
    </span>
  )
}
