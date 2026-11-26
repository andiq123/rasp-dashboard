import type { AppHistory, HistoryPoint } from '@/api/types'

export type AppSample = { app: AppHistory; cpu: number; memoryMB: number }
export type AppSummary = { app: AppHistory; avgCpu: number; peakCpu: number; avgMemMB: number; peakMemMB: number; spark: number[] }

/** Nearest sample to `at` (points are sorted by time); null when farther than `maxGap` seconds. */
function nearest(points: AppHistory['points'], at: number, maxGap: number) {
  let lo = 0
  let hi = points.length - 1
  if (hi < 0) return null
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].at < at) lo = mid + 1
    else hi = mid
  }
  const candidates = [points[lo], points[lo - 1]].filter(Boolean)
  const best = candidates.reduce((a, b) => (Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a))
  return Math.abs(best.at - at) <= maxGap ? best : null
}

/**
 * Which apps were busiest at one moment. App CPU is per core; dividing by the
 * core count puts it on the same scale as the system CPU line.
 */
export function appsAt(apps: AppHistory[], at: number, cores: number, maxGap: number): AppSample[] {
  const out: AppSample[] = []
  for (const app of apps) {
    const p = nearest(app.points, at, maxGap)
    if (p) out.push({ app, cpu: p.cpu_percent / Math.max(1, cores), memoryMB: p.memory_mb })
  }
  return out.sort((a, b) => b.cpu - a.cpu || b.memoryMB - a.memoryMB)
}

/** Range summary per app, busiest first. */
export function summarizeApps(apps: AppHistory[], cores: number): AppSummary[] {
  return apps
    .map((app) => {
      const cpu = app.points.map((p) => p.cpu_percent / Math.max(1, cores))
      const mem = app.points.map((p) => p.memory_mb)
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
      const step = Math.max(1, Math.floor(cpu.length / 40))
      return {
        app,
        avgCpu: avg(cpu),
        peakCpu: Math.max(0, ...cpu),
        avgMemMB: avg(mem),
        peakMemMB: Math.max(0, ...mem),
        spark: cpu.filter((_, i) => i % step === 0),
      }
    })
    .sort((a, b) => b.avgCpu - a.avgCpu || b.avgMemMB - a.avgMemMB)
}

/** Indexes of standout CPU peaks: well above the range's typical level, spaced apart. */
export function findSpikes(points: HistoryPoint[], max = 3): number[] {
  const cpu = points.map((p) => Number(p.cpu_percent || 0))
  if (cpu.length < 8) return []
  const sorted = [...cpu].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const threshold = Math.max(median * 2.5, median + 15)
  const gap = Math.max(4, Math.floor(cpu.length / 12))
  const picks: number[] = []
  const order = cpu.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0])
  for (const [v, i] of order) {
    if (v < threshold || picks.length >= max) break
    if (picks.every((j) => Math.abs(j - i) >= gap)) picks.push(i)
  }
  return picks.sort((a, b) => a - b)
}

/** True when apps explain little of a busy moment: the load came from the Pi itself. */
export function mostlySystem(systemCpu: number, samples: AppSample[]): boolean {
  const appsTotal = samples.reduce((sum, a) => sum + a.cpu, 0)
  return systemCpu >= 25 && appsTotal < systemCpu * 0.3
}
