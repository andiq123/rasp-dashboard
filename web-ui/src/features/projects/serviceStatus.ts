import type { LucideIcon } from 'lucide-react'
import { Archive, Box, Database, MemoryStick } from 'lucide-react'
import type { Service } from '@/api/types'
import type { IconWellTone } from '@/lib/ui'

export function isQueued(svc: Service): boolean {
  return svc.status === 'queued'
}

export function isBuilding(svc: Service): boolean {
  if (svc.type === 'postgres' || svc.type === 'bucket' || svc.type === 'redis') return false
  if (svc.status === 'queued') return false
  if (svc.status === 'building') return true
  return !!(svc.deployments || []).some((d) => d.status === 'building')
}

export function statusLabel(svc: Service): { text: string; badge: string } {
  if (svc.type === 'postgres' || svc.type === 'bucket' || svc.type === 'redis') {
    return svc.running
      ? { text: 'Ready', badge: 'badge-success' }
      : { text: 'Offline', badge: 'badge-ghost' }
  }
  if (isQueued(svc)) return { text: 'Queued', badge: 'badge-warning' }
  if (isBuilding(svc)) return { text: 'Building', badge: 'badge-info' }
  if (svc.status === 'failed') return { text: 'Failed', badge: 'badge-error' }
  if (svc.running) return { text: 'Running', badge: 'badge-success' }
  return { text: 'Stopped', badge: 'badge-ghost' }
}

/** One status → one color family for wells, borders, and dots. */
export function statusTone(
  svc: Service,
  opts?: { busy?: boolean; waiting?: boolean },
): IconWellTone {
  if (opts?.busy) return 'info'
  if (opts?.waiting || isQueued(svc)) return 'warning'
  if (svc.type === 'postgres' || svc.type === 'bucket' || svc.type === 'redis') {
    return svc.running ? 'success' : 'primary'
  }
  if (isBuilding(svc)) return 'info'
  if (svc.status === 'failed') return 'error'
  if (svc.running) return 'success'
  return 'primary'
}

export function statusBorder(tone: IconWellTone): string {
  switch (tone) {
    case 'info':
      return 'border-info/45'
    case 'warning':
      return 'border-warning/45'
    case 'error':
      return 'border-error/40'
    case 'success':
      return 'border-success/35'
    default:
      return 'border-base-300'
  }
}

export function statusDot(tone: IconWellTone): string {
  switch (tone) {
    case 'info':
      return 'status-info'
    case 'warning':
      return 'status-warning'
    case 'error':
      return 'status-error'
    case 'success':
      return 'status-success'
    default:
      return 'status-neutral'
  }
}

export function phaseLabel(phase?: string): string {
  switch (phase) {
    case 'provisioning':
      return 'Provisioning'
    case 'building':
      return 'Building'
    case 'deploying':
      return 'Deploying'
    default:
      return ''
  }
}

export function serviceTypeIcon(type: string): LucideIcon {
  switch (type) {
    case 'postgres':
      return Database
    case 'bucket':
      return Archive
    case 'redis':
      return MemoryStick
    default:
      return Box
  }
}
