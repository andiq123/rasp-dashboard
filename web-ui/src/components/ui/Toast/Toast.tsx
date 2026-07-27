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

export type ToastTone = 'success' | 'error' | 'info'

type ToastCtx = {
  showToast: (message: string, tone?: ToastTone) => void
}

const Ctx = createContext<ToastCtx | null>(null)

const alertClass: Record<ToastTone, string> = {
  success: 'alert-success',
  error: 'alert-error',
  info: 'alert-info',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ message, tone })
    timerRef.current = setTimeout(() => setToast(null), tone === 'error' ? 4200 : 2800)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast toast-bottom toast-center z-[60]">
        {toast ? (
          <div
            className={`alert ${alertClass[toast.tone]} shadow-md text-sm`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          >
            <span>{toast.message}</span>
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
