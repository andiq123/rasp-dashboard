import { Boxes, Database, HardDrive, Package } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber/AnimatedNumber'
import type { AppSummary } from '@/lib/appHistory'
import { fmtMB } from '@/lib/resources'

const typeIcon = { go: Package, postgres: Database, redis: Boxes, bucket: HardDrive } as const

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="top-spark" />
  const max = Math.max(1, ...values)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 100).toFixed(1)},${(22 - (v / max) * 20).toFixed(1)}`).join(' ')
  return (
    <svg className="top-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/** Apps ranked by how much of the Pi they used over the selected range. */
export function TopApps({ summaries }: { summaries: AppSummary[] }) {
  if (!summaries.length) return null
  const maxCpu = Math.max(0.1, ...summaries.map((s) => s.avgCpu))
  return (
    <section className="top-apps" aria-label="Apps by usage">
      <div className="top-head">
        <strong>Top apps</strong>
        <span>average CPU of the whole Pi, then memory</span>
      </div>
      <ol>
        {summaries.slice(0, 6).map((s, i) => {
          const Icon = typeIcon[s.app.type as keyof typeof typeIcon] || Package
          return (
            <li key={`${s.app.group}/${s.app.slug}`} className="top-row" style={{ animationDelay: `${i * 50}ms` }}>
              <span className="top-icon"><Icon aria-hidden /></span>
              <span className="top-name">
                <strong>{s.app.name}</strong>
                <small>{s.app.group}{s.app.shared ? ', shared engine' : ''}</small>
              </span>
              <span className="top-bar" title={`Peak ${s.peakCpu.toFixed(1)}%`}>
                <span style={{ width: `${(s.avgCpu / maxCpu) * 100}%` }} />
              </span>
              <span className="top-val"><AnimatedNumber value={s.avgCpu} format={(v) => `${v.toFixed(1)}%`} /></span>
              <span className="top-val is-mem"><AnimatedNumber value={s.avgMemMB} format={fmtMB} /></span>
              <Spark values={s.spark} />
            </li>
          )
        })}
      </ol>
    </section>
  )
}
