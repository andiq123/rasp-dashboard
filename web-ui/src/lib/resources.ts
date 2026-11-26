import type { DeviceMetrics, Service } from '@/api/types'

/** Clamp mirrors server clampResources (memory 64–3072, cpus 0.1–4). */
export const RESOURCE = {
  memMin: 64,
  memMax: 3072,
  memDefault: 512,
  cpuMin: 0.1,
  cpuMax: 4,
  cpuDefault: 1,
  cpuStep: 0.1,
} as const

export type Reserved = {
  memory_mb: number
  cpus: number
  dedicated_services: number
}

/** Sum dedicated Docker limits (Go and Redis; Postgres/bucket share engines). */
export function reservedFromServices(
  services: Service[],
  opts?: {
    excludeSlug?: string
    draft?: { memory_mb: number; cpus: number }
  },
): Reserved {
  let memory_mb = 0
  let cpus = 0
  let dedicated_services = 0
  for (const s of services) {
    if (s.type !== 'go' && s.type !== 'redis') continue
    if (opts?.excludeSlug && s.slug === opts.excludeSlug) continue
    memory_mb += s.memory_mb && s.memory_mb > 0 ? s.memory_mb : RESOURCE.memDefault
    cpus += s.cpus && s.cpus > 0 ? s.cpus : RESOURCE.cpuDefault
    dedicated_services++
  }
  if (opts?.draft) {
    memory_mb += opts.draft.memory_mb
    cpus += opts.draft.cpus
    dedicated_services++
  }
  return {
    memory_mb,
    cpus: Math.round(cpus * 10) / 10,
    dedicated_services,
  }
}

export type HostCapacity = {
  total_mb: number
  cores: number
  live_used_mb: number
  live_free_mb: number
  live_busy_percent: number
}

export function hostCapacity(metrics?: DeviceMetrics | null): HostCapacity {
  const total = Number(metrics?.memory?.total_bytes || 0)
  const used = Number(metrics?.memory?.used_bytes || 0)
  const total_mb = Math.max(0, Math.floor(total / (1024 * 1024)))
  const live_used_mb = Math.max(0, Math.floor(used / (1024 * 1024)))
  return {
    total_mb,
    cores: Math.max(0, Number(metrics?.cpu?.count || 0)),
    live_used_mb,
    live_free_mb: Math.max(0, total_mb - live_used_mb),
    live_busy_percent: Number(metrics?.cpu?.busy_percent || 0),
  }
}

/** What dedicated apps actually use right now (live Docker stats), not their limits. */
export function appUsage(services: Service[]): { memory_mb: number; cpus: number } {
  let memory_mb = 0
  let cpuPercent = 0
  for (const s of services) {
    if ((s.type !== 'go' && s.type !== 'redis') || !s.stats || s.stats.shared) continue
    memory_mb += Number(s.stats.memory_mb || 0)
    cpuPercent += Number(s.stats.cpu_percent || 0)
  }
  return { memory_mb, cpus: cpuPercent / 100 }
}

export function fmtMB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
