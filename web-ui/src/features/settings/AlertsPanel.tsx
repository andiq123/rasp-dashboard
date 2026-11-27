import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Copy, Dices, ExternalLink, Send, TriangleAlert } from 'lucide-react'
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
const NTFY_SERVER = 'https://ntfy.sh'
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/
const topicLabel = (url: string) => url.replace(/^https?:\/\//, '')

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
  const [edit, setEdit] = useState<{ server: string; topic: string } | null>(null)
  const saved = splitTopic(q.data?.ntfy_url || '')
  const { server, topic } = edit ?? saved
  const topicOk = TOPIC_RE.test(topic)
  const url = topicOk ? `${server}/${topic}` : ''
  // The topic starts right after the server prefix, however wide it renders.
  const prefixRef = useRef<HTMLSpanElement>(null)
  const [prefixW, setPrefixW] = useState(0)
  useLayoutEffect(() => {
    const el = prefixRef.current
    if (el) setPrefixW(el.offsetWidth)
  }, [server, q.isLoading, q.data?.enabled])
  const set = (data: AlertStatus) => qc.setQueryData(queryKeys.alerts, data)
  const onTopic = (value: string) => setEdit(value.includes('/') ? splitTopic(value) : { server, topic: value.trim() })
  async function copyTopic() {
    try {
      await navigator.clipboard.writeText(topic)
      showToast('Topic copied. Subscribe to it in the ntfy app.')
    } catch {
      showToast('Copy failed; select the topic and copy it', 'error')
    }
  }

  const save = useMutation({
    mutationFn: (enabled: boolean) => saveAlerts({ enabled, ntfy_url: enabled ? url : q.data?.ntfy_url || '' }),
    onSuccess: (data) => {
      set(data)
      setEdit(null)
      showToast(data.enabled ? 'Alerts turned on' : 'Alerts turned off')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })
  const test = useMutation({
    mutationFn: () => testAlerts(url),
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
            label="Topic"
            tip={server === NTFY_SERVER
              ? 'Anyone who knows the topic can read it, so keep it random. Subscribe to the same topic in the ntfy app.'
              : `Sent through ${topicLabel(server)}.`}
            htmlFor="alerts-topic"
          >
            <div className="password-input topic-input">
              <span ref={prefixRef} className="topic-prefix" aria-hidden>{topicLabel(server)}/</span>
              <Input
                id="alerts-topic"
                autoComplete="off"
                spellCheck={false}
                placeholder="your-secret-topic"
                value={topic}
                onChange={(e) => onTopic(e.target.value)}
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a className="btn btn-sm btn-ghost mr-auto" href={NTFY_APP} target="_blank" rel="noreferrer">
              Get ntfy <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
            <Button icon={<Send className="h-3.5 w-3.5" aria-hidden />} loading={test.isPending} disabled={!topicOk} onClick={() => test.mutate()}>
              Send test
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!topicOk}>
              Turn on
            </Button>
          </div>
        </form>
      )}
    </Panel>
  )
}
