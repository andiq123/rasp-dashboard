import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Clock3, Cpu, MemoryStick, Thermometer, Wifi } from 'lucide-react'
import { fetchServiceHistory, fetchSystemHistory } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import type { HistoryPoint } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { Empty } from '@/components/ui/Empty/Empty'
import { Spinner } from '@/components/ui/Spinner/Spinner'
import { fmtRate } from '@/lib/format'
import { muted, tile } from '@/lib/ui'

type Range = '1h' | '6h' | '24h' | '7d'

const ranges: Range[] = ['1h', '6h', '24h', '7d']

function average(points: HistoryPoint[], key: keyof HistoryPoint) {
  const values = points.map((point) => Number(point[key] || 0)).filter(Number.isFinite)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function peak(points: HistoryPoint[], key: keyof HistoryPoint) {
  return Math.max(0, ...points.map((point) => Number(point[key] || 0)).filter(Number.isFinite))
}

function linePath(points: HistoryPoint[], key: keyof HistoryPoint, ceiling: number) {
  if (!points.length) return ''
  const width = 640
  const height = 132
  return points
    .map((point, index) => {
      const x = points.length === 1 ? width : (index / (points.length - 1)) * width
      const value = Math.max(0, Math.min(ceiling, Number(point[key] || 0)))
      const y = height - (value / ceiling) * height
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function formatTime(at = 0) {
  if (!at) return '—'
  return new Date(at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Stat({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Cpu }) {
  return (
    <div className={`${tile} px-2.5 py-2 min-w-0`}>
      <span className={`flex items-center gap-1 text-[10px] font-bold uppercase ${muted}`}>
        <Icon className="h-3 w-3" aria-hidden /> {label}
      </span>
      <strong className="block text-base mt-0.5 tabular-nums">{value}</strong>
      <span className={`block text-[10px] truncate ${muted}`}>{detail}</span>
    </div>
  )
}

export function MonitorHistory({
  kind,
  group,
  slug,
  compact = false,
}: {
  kind: 'system' | 'service'
  group?: string
  slug?: string
  compact?: boolean
}) {
  const [range, setRange] = useState<Range>('6h')
  const query = useQuery({
    queryKey:
      kind === 'system'
        ? queryKeys.systemHistory(range)
        : queryKeys.serviceHistory(group || '', slug || '', range),
    queryFn: () =>
      kind === 'system'
        ? fetchSystemHistory(range)
        : fetchServiceHistory(group || '', slug || '', range),
    enabled: kind === 'system' || (!!group && !!slug),
    staleTime: 25_000,
    refetchInterval: 30_000,
  })
  const points = useMemo(() => query.data?.points || [], [query.data?.points])
  const latest = points.at(-1)
  const cpuPeak = peak(points, 'cpu_percent')
  const memoryPeak = peak(points, kind === 'system' ? 'memory_percent' : 'memory_mb')
  const cpuCeiling = kind === 'system' ? 100 : Math.max(100, Math.ceil(cpuPeak / 25) * 25)
  const memoryCeiling = kind === 'system' ? 100 : Math.max(64, Math.ceil(memoryPeak / 64) * 64)
  const uptime = points.length ? (points.filter((point) => point.running).length / points.length) * 100 : 0

  return (
    <section className="grid gap-2.5" aria-label={`${kind === 'system' ? 'System' : 'Service'} monitor history`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong className="text-sm inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-primary" aria-hidden /> Monitor history
          </strong>
          <p className={`text-[11px] m-0 mt-0.5 ${muted}`}>
            30-second samples · seven-day local retention · {points.length} chart {points.length === 1 ? 'point' : 'points'}
          </p>
        </div>
        <div className="join" aria-label="History range">
          {ranges.map((value) => (
            <Button
              key={value}
              variant={range === value ? 'primary' : 'quiet'}
              className="join-item min-h-7 h-7 px-2 text-[11px]"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <Spinner compact label="Loading monitor history…" />
      ) : query.isError ? (
        <Empty compact title="Could not load history" body={(query.error as Error).message} />
      ) : !points.length ? (
        <Empty compact title="Collecting the first sample" body="History appears automatically within 30 seconds." />
      ) : (
        <>
          <div className={`grid gap-1.5 ${compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
            <Stat
              icon={Cpu}
              label="CPU average"
              value={`${average(points, 'cpu_percent').toFixed(1)}%`}
              detail={`Peak ${cpuPeak.toFixed(1)}%`}
            />
            <Stat
              icon={MemoryStick}
              label="Memory"
              value={
                kind === 'system'
                  ? `${Number(latest?.memory_percent || 0).toFixed(1)}%`
                  : `${Number(latest?.memory_mb || 0).toFixed(1)}MB`
              }
              detail={
                kind === 'system'
                  ? `Average ${average(points, 'memory_percent').toFixed(1)}%`
                  : `Peak ${memoryPeak.toFixed(1)}MB`
              }
            />
            {kind === 'system' ? (
              <Stat
                icon={Thermometer}
                label="Temperature"
                value={`${Number(latest?.temperature_c || 0).toFixed(0)}°C`}
                detail={`Peak ${peak(points, 'temperature_c').toFixed(0)}°C`}
              />
            ) : (
              <Stat icon={Clock3} label="Observed up" value={`${uptime.toFixed(1)}%`} detail="Within selected range" />
            )}
            {!compact ? (
              kind === 'system' ? (
                <Stat
                  icon={Wifi}
                  label="Network now"
                  value={fmtRate(latest?.down_bps)}
                  detail={`Up ${fmtRate(latest?.up_bps)}`}
                />
              ) : (
                <Stat icon={Activity} label="Processes" value={`${latest?.pids || 0}`} detail={`Last sample ${formatTime(latest?.at)}`} />
              )
            ) : null}
          </div>

          <div className={`${tile} p-2.5 overflow-hidden`}>
            <div className="flex flex-wrap justify-between gap-2 mb-1 text-[10px]">
              <span className="inline-flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-info"><i className="w-2 h-0.5 bg-info" /> CPU</span>
                <span className="inline-flex items-center gap-1 text-primary"><i className="w-2 h-0.5 bg-primary" /> Memory</span>
              </span>
              <span className={muted}>{formatTime(points[0]?.at)} — {formatTime(latest?.at)}</span>
            </div>
            <svg viewBox="0 0 640 132" className={`w-full ${compact ? 'h-32' : 'h-40'} overflow-visible`} role="img" aria-label="CPU and memory history chart" preserveAspectRatio="none">
              {[0, 33, 66, 99, 132].map((y) => (
                <line key={y} x1="0" y1={y} x2="640" y2={y} className="stroke-base-300" strokeWidth="1" />
              ))}
              <g className="text-primary">
                <path d={linePath(points, kind === 'system' ? 'memory_percent' : 'memory_mb', memoryCeiling)} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </g>
              <g className="text-info">
                <path d={linePath(points, 'cpu_percent', cpuCeiling)} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </g>
            </svg>
            <p className={`text-[10px] m-0 mt-1 ${muted}`}>
              CPU scale 0–{cpuCeiling}% · Memory scale 0–{memoryCeiling}{kind === 'system' ? '%' : 'MB'} · Charts are downsampled on the Pi.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
