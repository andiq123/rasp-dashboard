import { useLayoutEffect } from 'react'

const WIDGETS = '.app-main :is(.card, .status-hero, .toolbar, .page-header)'
const STEP_MS = 70
const MAX_STEPS = 8

/**
 * One orchestrated entrance on first load: the bar settles, then each top-level
 * widget rises in order. Runs before first paint so nothing flashes, then gets
 * out of the way; route changes use the page transition instead.
 */
export function useIntro() {
  useLayoutEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    let i = 0
    for (const el of document.querySelectorAll<HTMLElement>(WIDGETS)) {
      if (el.parentElement?.closest(WIDGETS.replace('.app-main ', ''))) continue // nested widget: rides with its parent
      el.style.setProperty('--intro-i', String(Math.min(i++, MAX_STEPS)))
      el.dataset.intro = ''
    }
    root.classList.add('is-intro')
    const done = window.setTimeout(() => {
      root.classList.remove('is-intro')
      for (const el of document.querySelectorAll<HTMLElement>('[data-intro]')) {
        delete el.dataset.intro
        el.style.removeProperty('--intro-i')
      }
    }, 120 + MAX_STEPS * STEP_MS + 700)
    return () => window.clearTimeout(done)
  }, [])
}
