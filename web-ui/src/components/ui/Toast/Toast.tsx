import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ToastCtx = { showToast: (message: string) => void }

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const showToast = useCallback((msg: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setMessage(msg)
    timerRef.current = setTimeout(() => setMessage(null), 2800)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast toast-bottom toast-center z-[60]">
        {message ? (
          <div className="alert alert-success shadow-md" role="status" aria-live="polite">
            <span>{message}</span>
          </div>
        ) : null}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast requires ToastProvider')
  return ctx
}
