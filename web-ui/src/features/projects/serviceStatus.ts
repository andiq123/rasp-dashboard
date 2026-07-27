import type { LucideIcon } from 'lucide-react'
import { Box, Database, HardDrive } from 'lucide-react'
import type { Service } from '@/api/types'

export function isQueued(svc: Service): boolean {
  return svc.status === 'queued'
}

export function isBuilding(svc: Service): boolean {
  if (svc.type === 'postgres' || svc.type === 'bucket') return false
  if (svc.status === 'queued') return false
  if (svc.status === 'building') return true
  return !!(svc.deployments || []).some((d) => d.status === 'building')
}

export function statusLabel(svc: Service): { text: string; badge: string } {
  if (svc.type === 'postgres' || svc.type === 'bucket') {
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
      return HardDrive
    default:
      return Box
  }
}
