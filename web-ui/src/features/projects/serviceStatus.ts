import type { LucideIcon } from 'lucide-react'
import { Box, Database, HardDrive } from 'lucide-react'
import type { Service } from '@/api/types'

export function isBuilding(svc: Service): boolean {
  if (svc.type === 'postgres' || svc.type === 'bucket') return false
  if (svc.status === 'building') return true
  return !!(svc.deployments || []).some((d) => d.status === 'building' || d.status === 'queued')
}

export function statusLabel(svc: Service): { text: string; badge: string } {
  if (svc.type === 'postgres' || svc.type === 'bucket') {
    return svc.running
      ? { text: 'Ready', badge: 'badge-success' }
      : { text: 'Offline', badge: 'badge-ghost' }
  }
  if (isBuilding(svc)) return { text: 'Building', badge: 'badge-info' }
  if (svc.status === 'failed') return { text: 'Failed', badge: 'badge-error' }
  if (svc.running) return { text: 'Running', badge: 'badge-success' }
  return { text: 'Stopped', badge: 'badge-ghost' }
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
