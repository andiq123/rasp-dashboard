import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

type Pending = { group: string } | null

type Ctx = {
  pending: Pending
  setPending: (p: Pending) => void
  consumePending: () => void
}

const PendingCtx = createContext<Ctx | null>(null)

export function PendingAddGoProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>(null)
  const navigate = useNavigate()

  const consumePending = useCallback(() => {
    if (!pending?.group) return
    const g = pending.group
    setPending(null)
    navigate(`/projects/${encodeURIComponent(g)}?wizard=go`)
  }, [navigate, pending])

  const value = useMemo(() => ({ pending, setPending, consumePending }), [pending, consumePending])

  return <PendingCtx.Provider value={value}>{children}</PendingCtx.Provider>
}

export function usePendingAddGo() {
  const ctx = useContext(PendingCtx)
  if (!ctx) throw new Error('usePendingAddGo requires provider')
  return ctx
}
