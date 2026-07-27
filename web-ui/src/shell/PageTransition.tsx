import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

/** Top-level app section from the path (`/projects/foo` → `projects`). */
export function useAppSection(): string {
  const { pathname } = useLocation()
  const seg = pathname.split('/').filter(Boolean)[0]
  return seg || 'overview'
}

export const sectionTitles: Record<string, string> = {
  overview: 'Overview',
  projects: 'Projects',
  files: 'Files',
  settings: 'Settings',
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return reduced
}
/**
 * Soft enter when switching Overview / Projects / Files / Settings.
 * Skips motion when the user prefers reduced motion.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const section = useAppSection()
  const reduced = usePrefersReducedMotion()

  return (
    <div key={section} className={reduced ? undefined : 'page-enter'} data-page={section}>
      {children}
    </div>
  )
}

/** Scroll the main pane to top when the top-level section changes. */
export function ScrollMain({ mainId = 'app-main' }: { mainId?: string }) {
  const section = useAppSection()
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const el = document.getElementById(mainId)
    if (!el) return
    el.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }, [section, mainId, reduced])

  return null
}
