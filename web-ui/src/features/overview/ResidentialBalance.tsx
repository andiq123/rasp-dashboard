import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { setResidentialBalance } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { ResidentialUsage } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { Field, Input } from '@/components/ui/Field/Field'
import { Modal } from '@/components/ui/Modal/Modal'
import { useToast } from '@/components/ui/Toast/Toast'
import { fmtRelative } from '@/lib/format'

const IPROYAL_DASHBOARD = 'https://dashboard.iproyal.com'

/** Ask only when there is no balance yet or the last entry is over a week old. */
export const needsBalance = (u?: ResidentialUsage) => !u?.balance_set_at || !!u.balance_stale

type Props = {
  open: boolean
  usage?: ResidentialUsage
  /** Set when the dialog also confirms a switch to Residential. */
  switching?: boolean
  onClose: () => void
  /** Called after the balance is saved (or confirmed as still correct). */
  onDone: () => void
}

/**
 * The remaining residential data, read off the IPRoyal dashboard once. The Pi
 * counts down from it; the dialog only returns when the entry gets old.
 */
export function ResidentialBalanceDialog({ open, usage, switching = false, onClose, onDone }: Props) {
  const { showToast } = useToast()
  const qc = useQueryClient()
  const estimate = usage?.remaining_bytes != null ? (usage.remaining_bytes / 1e9).toFixed(2) : ''
  const [value, setValue] = useState<string | null>(null)
  const shown = value ?? estimate
  const gb = Number(shown.replace(',', '.'))
  const valid = shown.trim() !== '' && Number.isFinite(gb) && gb >= 0

  const save = useMutation({
    mutationFn: (amount: number) => setResidentialBalance(amount),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.state })
      setValue(null)
      if (!switching) showToast('Balance saved. The Pi counts down from here.')
      onDone()
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const close = () => {
    setValue(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={switching ? 'Switch to Residential' : 'Residential data left'}
      sub={
        usage?.balance_set_at
          ? `Last entered ${fmtRelative(usage.balance_set_at)}. The Pi has counted the data used since.`
          : 'Enter what the IPRoyal dashboard shows under Remaining traffic. The Pi counts down from it.'
      }
      onClose={close}
      footer={
        <>
          <a className="btn btn-sm btn-ghost mr-auto" href={IPROYAL_DASHBOARD} target="_blank" rel="noreferrer">
            Open IPRoyal <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          {usage?.balance_set_at && estimate && value === null ? (
            <Button loading={save.isPending && save.variables === Number(estimate)} onClick={() => save.mutate(Number(estimate))}>
              Still correct
            </Button>
          ) : null}
          <Button variant="primary" disabled={!valid} loading={save.isPending && save.variables === gb} onClick={() => save.mutate(gb)}>
            {switching ? 'Save and switch' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) save.mutate(gb)
        }}
      >
        <Field label="Remaining traffic" htmlFor="residential-balance" tip="In GB, as IPRoyal shows it, for example 0.79.">
          <div className="unit-input">
            <Input
              id="residential-balance"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="0.79"
              value={shown}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={shown.trim() !== '' && !valid}
            />
            <span aria-hidden>GB</span>
          </div>
        </Field>
      </form>
    </Modal>
  )
}
