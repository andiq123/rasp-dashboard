import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import styles from './Toast.module.css'

type ToastCtx = { showToast: (message: string) => void }

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback(
    (msg: string) => {
      if (timer) clearTimeout(timer)
      setMessage(msg)
      setTimer(setTimeout(() => setMessage(null), 2800))
    },
    [timer],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className={`${styles.toast} ${message ? styles.show : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast requires ToastProvider')
  return ctx
}
