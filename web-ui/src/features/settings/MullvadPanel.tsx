import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { clearMullvadAccount, fetchMullvadAccount, saveMullvadAccount } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { Button } from '@/components/ui/Button/Button'
import { useConfirm } from '@/components/ui/Confirm/Confirm'
import { Field, Input } from '@/components/ui/Field/Field'
import { Notice } from '@/components/ui/Notice/Notice'
import { Panel } from '@/components/ui/Panel/Panel'
import { PanelSkeleton } from '@/components/ui/Skeleton/Skeleton'
import { SwapText } from '@/components/ui/SwapText/SwapText'
import { useToast } from '@/components/ui/Toast/Toast'
import { daysLeftText, daysLeftTone, expiryDate, MULLVAD_ACCOUNT_URL } from '@/lib/mullvad'
import { muted } from '@/lib/ui'

/** Mullvad subscription: days left, renewal link, and the account number form. */
export function MullvadPanel() {
  const { showToast } = useToast()
  const { confirm } = useConfirm()
  const qc = useQueryClient()
  const [number, setNumber] = useState('')
  const acct = useQuery({ queryKey: queryKeys.mullvadAccount, queryFn: fetchMullvadAccount, refetchInterval: 60_000 })

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.mullvadAccount }),
    qc.invalidateQueries({ queryKey: queryKeys.state }),
  ])
  const save = useMutation({
    mutationFn: () => saveMullvadAccount(number),
    onSuccess: async () => {
      setNumber('')
      showToast('Mullvad account saved')
      await refresh()
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const clear = useMutation({
    mutationFn: clearMullvadAccount,
    onSuccess: async () => {
      showToast('Mullvad account removed')
      await refresh()
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  async function onRemove() {
    const ok = await confirm({
      title: 'Stop tracking Mullvad time?',
      body: 'The account number is deleted from this Pi. The VPN keeps working.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (ok) clear.mutate()
  }

  const a = acct.data
  const tone = daysLeftTone(a)
  return (
    <Panel
      title={<span className="inline-flex items-center gap-1.5"><ShieldCheck aria-hidden /> Mullvad</span>}
      actions={a?.configured ? <Button variant="dangerSoft" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} loading={clear.isPending} onClick={() => void onRemove()}>Remove</Button> : undefined}
      busy={acct.isFetching || save.isPending}
    >
      {acct.isLoading ? (
        <PanelSkeleton label="Checking Mullvad" />
      ) : a?.configured ? (
        <>
          <div className="item-row">
            <span className={`icon-chip tone-${tone || 'idle'}`}><ShieldCheck aria-hidden /></span>
            <span className="item-text">
              <strong className={tone === 'bad' ? 'text-error' : tone === 'warn' ? 'text-warning' : undefined}>
                <SwapText>{daysLeftText(a)}</SwapText>
              </strong>
              <span className="meta">
                <span>Until {expiryDate(a)}</span>
                <span>{a.masked}</span>
              </span>
            </span>
            <a className={`btn btn-sm ${tone && tone !== 'ok' ? 'btn-primary' : 'btn-success btn-soft'}`} href={MULLVAD_ACCOUNT_URL} target="_blank" rel="noreferrer">
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add time <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
            </a>
          </div>
          {a.error ? (
            <Notice icon={TriangleAlert} tone="warn" title="Could not refresh">
              {a.error}. Showing the last known date; it retries every 10 minutes.
            </Notice>
          ) : null}
        </>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (number.trim()) save.mutate()
          }}
        >
          <p className={`text-sm ${muted} m-0`}>Track how many days of VPN time are left, and get a warning a week before it ends.</p>
          <Field label="Account number" tip="16 digits. Stored only on this Pi, readable only by its owner." htmlFor="mullvad-account">
            <Input
              id="mullvad-account"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="1234 5678 9012 3456"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!number.trim()}>
              Start tracking
            </Button>
          </div>
        </form>
      )}
    </Panel>
  )
}
