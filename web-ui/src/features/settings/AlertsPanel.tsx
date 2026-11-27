import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Boxes, Copy, Dices, ExternalLink, Globe, Send, ShieldCheck, Thermometer, TriangleAlert, Wifi, type LucideIcon } from 'lucide-react'
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

const NTFY_APP = 'https://ntfy.sh/app'
const NTFY_SERVER = 'https://ntfy.sh'
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/
const hostLabel = (url: string) => url.replace(/^https?:\/\//, '')

/** What can reach the phone, in the backend's categories. */
const EVENTS: { id: AlertEvent; icon: LucideIcon; label: string; hint: string }[] = [
  { id: 'internet', icon: Wifi, label: 'Internet or VPN down', hint: 'After 2 minutes, or a leak' },
  { id: 'mullvad', icon: ShieldCheck, label: 'Mullvad time running low', hint: 'From 7 days left' },
  { id: 'apps', icon: Boxes, label: 'An app keeps crashing', hint: '3 restarts in 10 minutes' },
  { id: 'links', icon: Globe, label: 'A public link is down', hint: '2 failed checks in a row' },
  { id: 'pi', icon: Thermometer, label: 'Pi overheating or disk full', hint: 'Disk over 90%' },
]

/** A topic is its password on the public server: long and random. */
function randomTopic(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `firewifi-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`
}

/** Split a saved or pasted value into server and topic; a bare topic uses ntfy.sh. */
function splitTopic(raw: string): { server: string; topic: string } {
  const v = raw.trim()
  if (!v.includes('/')) return { server: NTFY_SERVER, topic: v }
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`)
    const parts = u.pathname.split('/').filter(Boolean)
    const topic = parts.pop() || ''
    return { server: `${u.origin}${parts.length ? `/${parts.join('/')}` : ''}`, topic }
  } catch {
    return { server: NTFY_SERVER, topic: v }
  }
}

/** Phone notifications through ntfy when the Pi needs attention. */
export function AlertsPanel() {
  const { showToast } = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: queryKeys.alerts, queryFn: fetchAlerts, refetchInterval: 30_000 })
  const a = q.data
  const [edit, setEdit] = useState<{ server: string; topic: string } | null>(null)
  const [mutedDraft, setMutedDraft] = useState<AlertEvent[] | null>(null)
  const { server, topic } = edit ?? splitTopic(a?.ntfy_url || '')
  const muted = mutedDraft ?? a?.muted ?? []
  const topicOk = TOPIC_RE.test(topic)
  const url = topicOk ? `${server}/${topic}` : ''

  // The topic starts right after the server prefix, however wide it renders.
  const prefixRef = useRef<HTMLSpanElement>(null)
  const [prefixW, setPrefixW] = useState(0)
  useLayoutEffect(() => {
    if (prefixRef.current) setPrefixW(prefixRef.current.offsetWidth)
  }, [server, a?.enabled])

  const save = useMutation({
    mutationFn: (body: AlertSettings) => saveAlerts(body),
    onSuccess: (data, body) => {
      qc.setQueryData<AlertStatus>(queryKeys.alerts, data)
      setEdit(null)
      setMutedDraft(null)
      if (body.enabled !== a?.enabled) showToast(data.enabled ? 'Alerts turned on' : 'Alerts turned off')
    },
    onError: (e: Error) => {
      setMutedDraft(null)
      showToast(e.message, 'error')
    },
  })
  const test = useMutation({
    mutationFn: () => testAlerts(url),
    onSuccess: (data) => {
      qc.setQueryData<AlertStatus>(queryKeys.alerts, data)
      showToast('Test notification sent')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  function toggleEvent(id: AlertEvent) {
    const next = muted.includes(id) ? muted.filter((m) => m !== id) : [...muted, id]
    setMutedDraft(next)
    // Once alerts are on, every change applies right away.
    if (a?.enabled) save.mutate({ enabled: true, ntfy_url: a.ntfy_url, muted: next })
  }

  async function copyTopic() {
    try {
      await navigator.clipboard.writeText(topic)
      showToast('Topic copied. Subscribe to it in the ntfy app.')
    } catch {
      showToast('Copy failed; select the topic and copy it', 'error')
    }
  }

  return (
    <Panel
      title={<span className="inline-flex items-center gap-1.5"><Bell aria-hidden /> Phone alerts</span>}
      actions={a?.enabled ? <Button variant="quiet" disabled={save.isPending} onClick={() => save.mutate({ enabled: false, ntfy_url: a.ntfy_url, muted })}>Turn off</Button> : undefined}
      busy={q.isFetching || save.isPending}
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
                <span className="meta"><span>{hostLabel(a.ntfy_url)}</span></span>
              </span>
              <Button icon={<Send className="h-3.5 w-3.5" aria-hidden />} loading={test.isPending} onClick={() => test.mutate()}>Test</Button>
            </div>
          ) : (
            <Field
              label="Topic"
              tip={server === NTFY_SERVER ? 'Anyone who knows the topic can read it, so keep it random. Subscribe to it in the ntfy app.' : `Sent through ${hostLabel(server)}.`}
              htmlFor="alerts-topic"
            >
              <div className="password-input topic-input">
                <span ref={prefixRef} className="topic-prefix" aria-hidden>{hostLabel(server)}/</span>
                <Input
                  id="alerts-topic"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="your-secret-topic"
                  value={topic}
                  onChange={(e) => setEdit(e.target.value.includes('/') ? splitTopic(e.target.value) : { server, topic: e.target.value.trim() })}
                  aria-invalid={topic !== '' && !topicOk}
                  style={prefixW ? { paddingLeft: prefixW + 13 } : undefined}
                />
                <button type="button" className="password-btn" title="Generate a random topic" aria-label="Generate a random topic" onClick={() => setEdit({ server, topic: randomTopic() })}>
                  <Dices aria-hidden />
                </button>
                <button type="button" className="password-btn" title="Copy topic" aria-label="Copy topic" disabled={!topicOk} onClick={() => void copyTopic()}>
                  <Copy aria-hidden />
                </button>
              </div>
            </Field>
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

          {!a?.enabled ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <a className="btn btn-sm btn-ghost mr-auto" href={NTFY_APP} target="_blank" rel="noreferrer">
                Get ntfy <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              <Button icon={<Send className="h-3.5 w-3.5" aria-hidden />} loading={test.isPending} disabled={!topicOk} onClick={() => test.mutate()}>Send test</Button>
              <Button variant="primary" loading={save.isPending} disabled={!topicOk} onClick={() => save.mutate({ enabled: true, ntfy_url: url, muted })}>Turn on</Button>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  )
}
