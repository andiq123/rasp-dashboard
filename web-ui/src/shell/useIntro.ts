import { useLayoutEffect, useRef } from 'react'

const WIDGETS = '.app-main :is(.card, .status-hero, .toolbar, .page-header, .settings-nav, .settings-group-head)'
const STEP_MS = 70
const MAX_STEPS = 8
const TOTAL_MS = 120 + MAX_STEPS * STEP_MS + 700

/**
 * One orchestrated entrance: each top-level widget of the page rises in order.
 * Runs on first load (the app bar settles too) and again whenever the section
 * changes, before paint, so a page never pops in and nothing flashes.
 */
export function useIntro(section: string) {
  const first = useRef(true)
  useLayoutEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    let i = 0
    const tagged: HTMLElement[] = []
    for (const el of document.querySelectorAll<HTMLElement>(WIDGETS)) {
      if (el.parentElement?.closest(WIDGETS.replace('.app-main ', ''))) continue // nested widget: rides with its parent
      el.style.setProperty('--intro-i', String(Math.min(i++, MAX_STEPS)))
      el.dataset.intro = ''
      tagged.push(el)
    }
    root.classList.add('is-intro')
    if (first.current) root.classList.add('is-intro-first')
    first.current = false
    const done = window.setTimeout(() => {
      root.classList.remove('is-intro', 'is-intro-first')
      for (const el of tagged) {
        delete el.dataset.intro
        el.style.removeProperty('--intro-i')
      }
    }, TOTAL_MS)
    return () => window.clearTimeout(done)
  }, [section])
}
