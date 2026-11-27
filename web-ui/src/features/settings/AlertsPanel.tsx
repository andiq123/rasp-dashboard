import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ExternalLink, Send, TriangleAlert } from 'lucide-react'
import { fetchAlerts, saveAlerts, testAlerts } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { AlertStatus } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { Field, Input } from '@/components/ui/Field/Field'
import { Notice } from '@/components/ui/Notice/Notice'
import { Panel } from '@/components/ui/Panel/Panel'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { SwapText } from '@/components/ui/SwapText/SwapText'
import { useToast } from '@/components/ui/Toast/Toast'
import { muted } from '@/lib/ui'

const NTFY_APP = 'https://ntfy.sh/app'
const topicLabel = (url: string) => url.replace(/^https?:\/\//, '')

/** Phone notifications through ntfy when the Pi needs attention. */
export function AlertsPanel() {
  const { showToast } = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: queryKeys.alerts, queryFn: fetchAlerts, refetchInterval: 30_000 })
  const [draft, setDraft] = useState('')
  const set = (data: AlertStatus) => qc.setQueryData(queryKeys.alerts, data)

  const save = useMutation({
    mutationFn: (enabled: boolean) => saveAlerts({ enabled, ntfy_url: enabled ? draft.trim() || q.data?.ntfy_url || '' : q.data?.ntfy_url || '' }),
    onSuccess: (data) => {
      set(data)
      setDraft('')
      showToast(data.enabled ? 'Alerts turned on' : 'Alerts turned off')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const test = useMutation({
    mutationFn: () => testAlerts(draft.trim()),
    onSuccess: (data) => {
      set(data)
      showToast('Test notification sent')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const a = q.data
  return (
    <Panel
      title={<span className="inline-flex items-center gap-1.5"><Bell aria-hidden /> Phone alerts</span>}
      actions={a?.enabled ? <Button variant="quiet" loading={save.isPending} onClick={() => save.mutate(false)}>Turn off</Button> : undefined}
      busy={q.isFetching || save.isPending}
    >
      {q.isLoading ? (
        <Spinner compact label="Loading alerts…" />
      ) : a?.enabled ? (
        <>
          <div className="item-row">
            <span className={`icon-chip tone-${a.active.length ? 'warn' : 'ok'}`}><Bell aria-hidden /></span>
            <span className="item-text">
              <strong><SwapText>{a.active.length ? `${a.active.length} open: ${a.active.join(', ')}` : 'On, nothing needs you'}</SwapText></strong>
              <span className="meta"><span>{topicLabel(a.ntfy_url)}</span></span>
            </span>
            <Button icon={<Send className="h-3.5 w-3.5" aria-hidden />} loading={test.isPending} onClick={() => test.mutate()}>
              Test
            </Button>
          </div>
          {a.last_error ? <Notice icon={TriangleAlert} tone="warn" title="Last send failed">{a.last_error}</Notice> : null}
        </>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(true)
          }}
        >
          <p className={`text-sm ${muted} m-0`}>
            Get a notification when the VPN or internet is down for 2 minutes, Mullvad time runs low, the disk fills up or the Pi overheats.
          </p>
          <Field
            label="ntfy topic URL"
            tip="Install the free ntfy app, subscribe to a hard-to-guess topic, and paste its URL here."
            htmlFor="alerts-url"
          >
            <Input
              id="alerts-url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://ntfy.sh/your-private-topic"
              value={draft || a?.ntfy_url || ''}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a className="btn btn-sm btn-ghost mr-auto" href={NTFY_APP} target="_blank" rel="noreferrer">
              Get ntfy <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
            <Button icon={<Send className="h-3.5 w-3.5" aria-hidden />} loading={test.isPending} disabled={!(draft.trim() || a?.ntfy_url)} onClick={() => test.mutate()}>
              Send test
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!(draft.trim() || a?.ntfy_url)}>
              Turn on
            </Button>
          </div>
        </form>
      )}
    </Panel>
  )
}
