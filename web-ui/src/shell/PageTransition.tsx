import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** Top-level app section from the path (`/projects/foo` → `projects`). */
export function useAppSection(): string {
  const { pathname } = useLocation()
  return pathname.split('/').filter(Boolean)[0] || 'overview'
}

/** Return to the top when the top-level section changes. */
export function ScrollMain() {
  const section = useAppSection()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [section])
  return null
}
