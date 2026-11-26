import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchAppsHistory, fetchServiceHistory, fetchSystemHistory } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { HistoryPoint } from '@/api/types'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber/AnimatedNumber'
import { Empty } from '@/components/ui/Empty/Empty'
import { Segmented } from '@/components/ui/Segmented/Segmented'
import { useLiveState } from '@/hooks/useLiveState'
import { appsAt, findSpikes, mostlySystem, summarizeApps } from '@/lib/appHistory'
import { fmtMB } from '@/lib/resources'
import { TopApps } from './TopApps'

type Range = '1h' | '6h' | '24h' | '7d'

const ranges: { value: Range; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
]

const W = 640
const H = 150
const PAD = 8

type Series = {
  key: keyof HistoryPoint
  label: string
  color: string
  ceiling: number
  format: (v: number) => string
  dashed?: boolean
  area?: boolean
}

const num = (point: HistoryPoint | undefined, key: keyof HistoryPoint) => {
  const v = Number(point?.[key] ?? 0)
  return Number.isFinite(v) ? v : 0
}

const peak = (points: HistoryPoint[], key: keyof HistoryPoint) => points.reduce((max, p) => Math.max(max, num(p, key)), 0)

const f = (n: number) => n.toFixed(1)

/** Monotone cubic path (Fritsch–Carlson): smooth, never overshoots the data. */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length
  if (!n) return ''
  if (n === 1) return `M0,${f(pts[0][1])} L${W},${f(pts[0][1])}`
  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++) slopes.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]))
  const tangents = [slopes[0]]
  for (let i = 1; i < n - 1; i++) tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2)
  tangents.push(slopes[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const a = tangents[i] / slopes[i]
    const b = tangents[i + 1] / slopes[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      tangents[i] = k * a * slopes[i]
      tangents[i + 1] = k * b * slopes[i]
    }
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1][0] - pts[i][0]) / 3
    d += ` C${f(pts[i][0] + h)},${f(pts[i][1] + tangents[i] * h)} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - tangents[i + 1] * h)} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`
  }
  return d
}

const xAt = (i: number, n: number) => (n <= 1 ? W : (i / (n - 1)) * W)
const yAt = (v: number, ceiling: number) => PAD + (1 - Math.max(0, Math.min(ceiling, v)) / ceiling) * (H - PAD * 2)

function timeLabel(at = 0, range: Range) {
  if (!at) return ''
  const d = new Date(at * 1000)
  return range === '7d'
    ? d.toLocaleDateString([], { weekday: 'short', day: 'numeric' })
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function hoverLabel(at = 0) {
  if (!at) return ''
  return new Date(at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type Props = {
  kind: 'system' | 'service'
  group?: string
  slug?: string
  compact?: boolean
  /** Hide the title when a surrounding section already names the chart. */
  bare?: boolean
}

export function MonitorHistory({ kind, group, slug, compact = false, bare = false }: Props) {
  const [range, setRange] = useState<Range>('6h')
  const [hover, setHover] = useState<number | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const query = useQuery({
    queryKey: kind === 'system' ? queryKeys.systemHistory(range) : queryKeys.serviceHistory(group || '', slug || '', range),
    queryFn: () => (kind === 'system' ? fetchSystemHistory(range) : fetchServiceHistory(group || '', slug || '', range)),
    enabled: kind === 'system' || (!!group && !!slug),
    staleTime: 25_000,
    refetchInterval: 30_000,
    // Keep the current chart on screen while another range loads: no spinner flash.
    placeholderData: keepPreviousData,
  })
  const points = useMemo(() => query.data?.points || [], [query.data?.points])
  // System view: every app's history, to rank consumers and explain spikes.
  const appsQ = useQuery({
    queryKey: queryKeys.appsHistory(range),
    queryFn: () => fetchAppsHistory(range),
    enabled: kind === 'system',
    staleTime: 25_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  })
  const cores = Number(useLiveState().state.device_metrics?.cpu?.count) || 4
  const apps = useMemo(() => appsQ.data || [], [appsQ.data])
  const summaries = useMemo(() => summarizeApps(apps, cores), [apps, cores])
  const spikes = useMemo(() => (kind === 'system' ? findSpikes(points) : []), [kind, points])
  const bucketSeconds = points.length > 1 ? Math.max(30, (points[points.length - 1].at - points[0].at) / (points.length - 1)) : 60
  const latest = points.at(-1)
  const switching = query.isPlaceholderData

  const series = useMemo<Series[]>(() => {
    if (kind === 'service') {
      const cpuPeak = peak(points, 'cpu_percent')
      const memPeak = peak(points, 'memory_mb')
      return [
        { key: 'cpu_percent', label: 'CPU', color: 'var(--color-info)', ceiling: Math.max(100, Math.ceil(cpuPeak / 25) * 25), format: (v) => `${v.toFixed(1)}%`, area: true },
        { key: 'memory_mb', label: 'Memory', color: 'var(--color-primary)', ceiling: Math.max(64, Math.ceil(memPeak / 64) * 64), format: (v) => `${v.toFixed(0)} MB` },
      ]
    }
    const tempPeak = peak(points, 'temperature_c')
    return [
      { key: 'cpu_percent', label: 'CPU', color: 'var(--color-info)', ceiling: 100, format: (v) => `${v.toFixed(1)}%`, area: true },
      { key: 'memory_percent', label: 'Memory', color: 'var(--color-primary)', ceiling: 100, format: (v) => `${v.toFixed(1)}%` },
      ...(tempPeak > 0
        ? [{ key: 'temperature_c' as const, label: 'Temperature', color: 'var(--color-warning)', ceiling: Math.max(100, Math.ceil(tempPeak / 10) * 10), format: (v: number) => `${v.toFixed(0)}°C`, dashed: true }]
        : []),
    ]
  }, [kind, points])

  const paths = useMemo(
    () =>
      series.map((s) => {
        const line = smoothPath(points.map((p, i) => [xAt(i, points.length), yAt(num(p, s.key), s.ceiling)]))
        return { key: s.key, line, area: s.area && line ? `${line} L${W},${H} L0,${H} Z` : '' }
      }),
    [series, points],
  )

  const visible = series.filter((s) => !hidden.has(String(s.key)))
  const active = hover == null ? null : points[Math.min(hover, points.length - 1)]
  const activeIndex = hover == null ? 0 : Math.min(hover, points.length - 1)
  const activeLeft = (xAt(activeIndex, points.length) / W) * 100
  const uptime = kind === 'service' && points.length ? (points.filter((p) => p.running).length / points.length) * 100 : null

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (series.length - next.size > 1) next.add(key) // keep at least one line
      return next
    })
  }

  function pick(clientX: number, el: HTMLElement) {
    const rect = el.getBoundingClientRect()
    if (!points.length || rect.width <= 0) return
    setHover(Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (points.length - 1)))
  }

  return (
    <section className="history" aria-label={`${kind === 'system' ? 'System' : 'Service'} history`}>
      {!bare ? <strong className="text-sm">History</strong> : null}

      <div className="history-bar">
        <div className="history-legend" role="group" aria-label="Lines shown">
          {series.map((s) => {
            const on = !hidden.has(String(s.key))
            return (
              <button
                key={String(s.key)}
                type="button"
                className="series-chip"
                aria-pressed={on}
                style={{ '--series': s.color } as React.CSSProperties}
                onClick={() => toggle(String(s.key))}
              >
                <span className={`series-swatch${s.dashed ? ' is-dashed' : ''}`} aria-hidden />
                {s.label}
                <b>{latest ? <AnimatedNumber value={num(active ?? latest, s.key)} format={s.format} /> : '—'}</b>
              </button>
            )
          })}
          {uptime != null ? <span className="history-note">Up {uptime.toFixed(1)}% of this range</span> : null}
        </div>
        <div className="history-range">
          <Segmented label="History range" options={ranges} value={range} onChange={(r) => { setHover(null); setRange(r) }} />
        </div>
      </div>

      {query.isLoading ? (
        <div className={`chart-skeleton${compact ? ' is-compact' : ''}`} aria-label="Loading history" />
      ) : query.isError ? (
        <Empty compact title="Could not load history" body={(query.error as Error).message} />
      ) : !points.length ? (
        <Empty compact title="Collecting the first sample" body="History appears within 30 seconds." />
      ) : (
        <div className={`chart${switching ? ' is-switching' : ''}`}>
          <div
            className="chart-plot"
            role="img"
            tabIndex={0}
            aria-label={`${series.map((s) => s.label).join(', ')} over the last ${range}`}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover((h) => h ?? points.length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const step = e.key === 'ArrowLeft' ? -1 : 1
              setHover((h) => Math.max(0, Math.min(points.length - 1, (h ?? points.length - 1) + step)))
            }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={compact ? 'is-compact' : undefined} aria-hidden>
              <defs>
                {series.filter((s) => s.area).map((s) => (
                  <linearGradient key={String(s.key)} id={`fill-${kind}-${String(s.key)}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>
              {[0.25, 0.5, 0.75].map((r) => (
                <line key={r} x1="0" x2={W} y1={PAD + r * (H - PAD * 2)} y2={PAD + r * (H - PAD * 2)} className="chart-grid" />
              ))}
              {/* Re-keyed per range so a new range draws in; 30s refreshes update in place. */}
              <g key={range} className="chart-reveal">
                {paths.map((p, i) => {
                  const s = series[i]
                  const off = hidden.has(String(s.key))
                  return (
                    <g key={String(p.key)} className={`chart-series${off ? ' is-off' : ''}`}>
                      {p.area ? <path d={p.area} fill={`url(#fill-${kind}-${String(s.key)})`} /> : null}
                      <path d={p.line} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    </g>
                  )
                })}
              </g>
            </svg>

            {spikes.map((i) => {
              const cpuSeries = series[0]
              const at = apps.length ? appsAt(apps, points[i].at, cores, bucketSeconds * 1.5) : []
              const cause = mostlySystem(num(points[i], 'cpu_percent'), at) ? 'the Pi itself' : at[0]?.app.name
              return (
                <button
                  key={points[i].at}
                  type="button"
                  className="chart-spike"
                  style={{ left: `${(xAt(i, points.length) / W) * 100}%`, top: `${(yAt(num(points[i], cpuSeries.key), cpuSeries.ceiling) / H) * 100}%` }}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  aria-label={`CPU spike at ${hoverLabel(points[i].at)}${cause ? `, mostly ${cause}` : ''}`}
                  title={cause ? `Spike: mostly ${cause}` : 'Spike'}
                />
              )
            })}
            {active ? (
              <>
                <span className="chart-cursor" style={{ left: `${activeLeft}%` }} aria-hidden />
                {visible.map((s) => (
                  <span
                    key={String(s.key)}
                    className="chart-marker"
                    style={{ left: `${activeLeft}%`, top: `${(yAt(num(active, s.key), s.ceiling) / H) * 100}%`, '--series': s.color } as React.CSSProperties}
                    aria-hidden
                  />
                ))}
                <div
                  className="chart-tip"
                  role="tooltip"
                  // Sit beside the cursor, never on top of the point being read.
                  style={{ left: `${activeLeft}%`, translate: activeLeft > 50 ? 'calc(-100% - 14px) 0' : '14px 0' }}
                >
                  <strong>{hoverLabel(active.at)}</strong>
                  {visible.map((s) => (
                    <span key={String(s.key)} className="chart-tip-row" style={{ '--series': s.color } as React.CSSProperties}>
                      <span>{s.label}</span>
                      <b>{s.format(num(active, s.key))}</b>
                    </span>
                  ))}
                  {kind === 'system' && apps.length ? (() => {
                    const top = appsAt(apps, active.at, cores, bucketSeconds * 1.5)
                    const system = mostlySystem(num(active, 'cpu_percent'), top)
                    return (
                    <span className="chart-tip-apps">
                      <small>{system ? 'Mostly the Pi itself, not your apps' : 'Busiest apps'}</small>
                      {top.slice(0, 3).map((a) => (
                        <span key={`${a.app.group}/${a.app.slug}`} className="chart-tip-app">
                          <span>{a.app.name}</span>
                          <b>{a.cpu.toFixed(1)}%</b>
                          <em>{fmtMB(a.memoryMB)}</em>
                        </span>
                      ))}
                    </span>
                    )
                  })() : null}
                </div>
              </>
            ) : null}
          </div>
          <div className="chart-axis" aria-hidden>
            <span>{timeLabel(points[0]?.at, range)}</span>
            <span>{timeLabel(points[Math.floor((points.length - 1) / 2)]?.at, range)}</span>
            <span>{timeLabel(latest?.at, range)}</span>
          </div>
        </div>
      )}
      {kind === 'system' && points.length ? <TopApps summaries={summaries} /> : null}
    </section>
  )
}
