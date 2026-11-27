import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Bell, Boxes, Check, Coins, ExternalLink, Globe, Send, ShieldCheck, Thermometer, TriangleAlert, Wifi, type LucideIcon } from 'lucide-react'
import { fetchAlerts, saveAlerts, testAlerts } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { AlertEvent, AlertSettings, AlertStatus } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { Field, Input } from '@/components/ui/Field/Field'
import { Notice } from '@/components/ui/Notice/Notice'
import { Panel } from '@/components/ui/Panel/Panel'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { SwapText } from '@/components/ui/SwapText/SwapText'
import { useToast } from '@/components/ui/Toast/Toast'

const BARK_APP = 'https://apps.apple.com/app/id1403753865'
const BARK_SERVER = 'https://api.day.app'
const KEY_RE = /^[A-Za-z0-9]{8,64}$/

/** What can reach the phone, in the backend's categories. */
const EVENTS: { id: AlertEvent; icon: LucideIcon; label: string; hint: string }[] = [
  { id: 'internet', icon: Wifi, label: 'Internet or VPN down', hint: 'After 2 minutes, or a leak' },
  { id: 'mullvad', icon: ShieldCheck, label: 'Mullvad time running low', hint: 'From 7 days left' },
  { id: 'apps', icon: Boxes, label: 'An app keeps crashing', hint: '3 restarts in 10 minutes' },
  { id: 'links', icon: Globe, label: 'A public link is down', hint: '2 failed checks in a row' },
  { id: 'pi', icon: Thermometer, label: 'Pi overheating or disk full', hint: 'Disk over 90%' },
  { id: 'route', icon: ArrowLeftRight, label: 'Route switched', hint: 'Mullvad ⇄ Residential, with the new IP' },
  { id: 'cost', icon: Coins, label: 'Still on Residential', hint: 'Every 2 minutes, with data used' },
]

/** Bark shows a URL like https://api.day.app/<key>/…; a bare key works too. */
function parseTarget(raw: string): { server: string; key: string } | null {
  const v = raw.trim()
  if (!v) return null
  if (!v.includes('/')) return KEY_RE.test(v) ? { server: BARK_SERVER, key: v } : null
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`)
    const key = u.pathname.split('/').filter(Boolean)[0] || ''
    return KEY_RE.test(key) ? { server: u.origin, key } : null
  } catch {
    return null
  }
}

const masked = (key: string) => `•••• ${key.slice(-4)}`
const hostOf = (server: string) => server.replace(/^https?:\/\//, '')

/** Phone notifications through Bark when the Pi needs attention. */
export function AlertsPanel() {
  const { showToast } = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: queryKeys.alerts, queryFn: fetchAlerts, refetchInterval: 30_000 })
  const a = q.data
  const [draft, setDraft] = useState('')
  const [mutedDraft, setMutedDraft] = useState<AlertEvent[] | null>(null)
  const muted = mutedDraft ?? a?.muted ?? []
  const target = parseTarget(draft)

  const save = useMutation({
    mutationFn: (body: AlertSettings) => saveAlerts(body),
    onSuccess: (data, body) => {
      qc.setQueryData<AlertStatus>(queryKeys.alerts, data)
      // A newer toggle may still be saving: keep it until its own save lands.
      setMutedDraft((d) => (d && d.join() !== (body.muted || []).join() ? d : null))
      if (body.enabled === a?.enabled) return
      if (!data.enabled) showToast('Alerts turned off')
    },
    onError: (e: Error) => {
      setMutedDraft(null)
      showToast(e.message, 'error')
    },
  })
  // Test the key being typed (before saving) or the saved one.
  const test = useMutation({
    mutationFn: () => (a?.enabled ? testAlerts() : testAlerts(target?.server, target?.key)),
    onSuccess: (data) => qc.setQueryData<AlertStatus>(queryKeys.alerts, data),
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  // "Sent" shows on the button for a moment, then it is ready again.
  const { isSuccess: testSent, reset: resetTest } = test
  useEffect(() => {
    if (!testSent) return
    const t = window.setTimeout(resetTest, 2500)
    return () => window.clearTimeout(t)
  }, [testSent, resetTest])
  const testButton = (disabled = false) => (
    <Button
      icon={testSent ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
      loading={test.isPending}
      disabled={disabled}
      onClick={() => test.mutate()}
    >
      <SwapText>{testSent ? 'Sent' : 'Test'}</SwapText>
    </Button>
  )

  /** One step: save the key, switch on, and send a welcome push to prove it works. */
  const connect = useMutation({
    mutationFn: async (t: { server: string; key: string }) => {
      await saveAlerts({ enabled: true, server: t.server, key: t.key, muted })
      return testAlerts()
    },
    onSuccess: (data) => {
      qc.setQueryData<AlertStatus>(queryKeys.alerts, data)
      setDraft('')
      showToast('Alerts are on. A welcome notification is on its way.')
    },
    onError: (e: Error) => {
      void qc.invalidateQueries({ queryKey: queryKeys.alerts })
      showToast(e.message, 'error')
    },
  })

  function toggleEvent(id: AlertEvent) {
    const next = muted.includes(id) ? muted.filter((m) => m !== id) : [...muted, id]
    setMutedDraft(next)
    // Once alerts are on, every change applies right away.
    if (a?.enabled) save.mutate({ enabled: true, server: a.server, key: a.key, muted: next })
  }

  return (
    <Panel
      title={<span className="inline-flex items-center gap-1.5"><Bell aria-hidden /> Phone alerts</span>}
      actions={a?.enabled ? <Button variant="quiet" disabled={save.isPending} onClick={() => save.mutate({ enabled: false, server: a.server, key: a.key, muted })}>Turn off</Button> : undefined}
      busy={q.isFetching || save.isPending || connect.isPending}
    >
      {q.isLoading ? (
        <Spinner compact label="Loading alerts…" />
      ) : (
        <>
          {a?.enabled ? (
            <div className="item-row">
              <span className={`icon-chip tone-${a.active.length ? 'warn' : 'ok'}`}><Bell aria-hidden /></span>
              <span className="item-text">
                <strong><SwapText>{a.active.length ? `${a.active.length} open: ${a.active.join(', ')}` : 'On, nothing needs you'}</SwapText></strong>
                <span className="meta">
                  <span>Bark {masked(a.key)}</span>
                  {a.server !== BARK_SERVER ? <span>{hostOf(a.server)}</span> : null}
                </span>
              </span>
              {testButton()}
            </div>
          ) : (
            <form
              className="bark-connect"
              onSubmit={(e) => {
                e.preventDefault()
                if (target) connect.mutate(target)
              }}
            >
              <Field label="Bark key" tip="Open Bark on your iPhone, copy the URL it shows and paste it here. That is all." htmlFor="alerts-key">
                <Input
                  id="alerts-key"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://api.day.app/your-key"
                  value={draft}
                  disabled={connect.isPending}
                  aria-invalid={draft.trim() !== '' && !target}
                  onChange={(e) => setDraft(e.target.value)}
                  onPaste={(e) => {
                    // Pasting is the whole setup: connect right away.
                    const t = parseTarget(e.clipboardData.getData('text'))
                    if (t) {
                      e.preventDefault()
                      setDraft(e.clipboardData.getData('text').trim())
                      connect.mutate(t)
                    }
                  }}
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <a className="btn btn-sm btn-ghost" href={BARK_APP} target="_blank" rel="noreferrer">
                  Get Bark <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
                <span className="flex gap-2">
                  {testButton(!target || connect.isPending)}
                  <Button type="submit" variant="primary" loading={connect.isPending} disabled={!target}>Turn on</Button>
                </span>
              </div>
            </form>
          )}

          <fieldset className="event-list">
            <legend>Notify me when</legend>
            {EVENTS.map((ev) => (
              <label key={ev.id} className="event-row">
                <ev.icon aria-hidden />
                <span className="event-text">
                  <strong>{ev.label}</strong>
                  <small>{ev.hint}</small>
                </span>
                <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={!muted.includes(ev.id)} onChange={() => toggleEvent(ev.id)} />
              </label>
            ))}
          </fieldset>

          {a?.last_error ? <Notice icon={TriangleAlert} tone="warn" title="Last send failed">{a.last_error}</Notice> : null}
        </>
      )}
    </Panel>
  )
}
