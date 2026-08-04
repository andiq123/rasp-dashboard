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
import { createPortal } from 'react-dom'

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

function resolveToastHost(): Element | null {
  if (typeof document === 'undefined') return null
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
  return dialogs.item(dialogs.length - 1) || document.body
}

function compactToastMessage(message: string): string {
  const compact = String(message || 'Something went wrong').replace(/\s+/g, ' ').trim()
  return compact.length > 280 ? `${compact.slice(0, 277)}…` : compact
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null)
  const [portalHost, setPortalHost] = useState<Element | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!toast || typeof document === 'undefined') return
    const updateHost = () => {
      setPortalHost(resolveToastHost())
    }
    updateHost()
    // Native modal dialogs live in the browser's top layer, above any normal
    // z-index. Follow the active dialog, then return to body when it closes.
    const observer = new MutationObserver(updateHost)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    })
    return () => observer.disconnect()
  }, [toast])

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPortalHost(resolveToastHost())
    setToast({ message: compactToastMessage(message), tone })
    timerRef.current = setTimeout(() => setToast(null), tone === 'error' ? 4200 : 2800)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && portalHost ? createPortal(
        <div className="toast toast-bottom toast-center z-[300] pointer-events-none px-2">
          <div
            className={`alert ${alertClass[toast.tone]} shadow-lg text-sm pointer-events-auto max-w-[min(34rem,calc(100vw-1rem))] whitespace-normal break-words`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          >
            <span>{toast.message}</span>
          </div>
        </div>,
        portalHost,
      ) : null}
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast requires ToastProvider')
  return ctx
}
