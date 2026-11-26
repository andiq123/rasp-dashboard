import { useEffect, useState } from 'react'

/**
 * Follows `value`, but only adopts a new value once it has held for `delayMs`.
 * Values for which `immediate(value)` is true are adopted at once, so good news
 * (back online, repair started) shows instantly while brief blips never flash.
 */
export function useSettled<T>(value: T, delayMs: number, immediate?: (value: T) => boolean): T {
  const [settled, setSettled] = useState(value)
  const adoptNow = Object.is(value, settled) || !!immediate?.(value)

  useEffect(() => {
    if (adoptNow) return
    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs, adoptNow])

  // Adopt immediate values during render: no extra frame showing the old state.
  if (adoptNow && !Object.is(value, settled)) {
    setSettled(value)
    return value
  }
  return settled
}
