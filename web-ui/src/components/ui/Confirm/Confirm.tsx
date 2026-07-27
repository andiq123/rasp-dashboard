import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '@/components/ui/Button/Button'
import { Modal } from '@/components/ui/Modal/Modal'

export type ConfirmOptions = {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmCtx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const Ctx = createContext<ConfirmCtx | null>(null)

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const close = useCallback((ok: boolean) => {
    const cur = pendingRef.current
    pendingRef.current = null
    setPending(null)
    cur?.resolve(ok)
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      if (pendingRef.current) pendingRef.current.resolve(false)
      const next: Pending = { ...opts, resolve }
      pendingRef.current = next
      setPending(next)
    })
  }, [])

  const value = useMemo(() => ({ confirm }), [confirm])

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={!!pending}
        title={pending?.title || ''}
        sub={pending?.body}
        onClose={() => close(false)}
        footer={
          <>
            <Button variant="quiet" onClick={() => close(false)}>
              {pending?.cancelLabel || 'Cancel'}
            </Button>
            <Button
              variant={pending?.danger ? 'dangerSoft' : 'primary'}
              onClick={() => close(true)}
            >
              {pending?.confirmLabel || 'Confirm'}
            </Button>
          </>
        }
      />
    </Ctx.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConfirm requires ConfirmProvider')
  return ctx
}
