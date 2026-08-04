import { Link } from 'react-router-dom'
import { CircleStop, Loader2, Play, RotateCw } from 'lucide-react'
import type { ActivitySnapshot, Service } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { ServiceUsage } from '@/components/ui/UsageMeter/UsageMeter'
import { activityMatchesService } from '@/hooks/useActivity'
import { iconWell, muted } from '@/lib/ui'
import {
  isBuilding,
  isQueued,
  serviceTypeIcon,
  statusBorder,
  statusDot,
  statusLabel,
  statusTone,
} from './serviceStatus'

type Props = {
  group: string
  svc: Service
  selected: boolean
  activity: ActivitySnapshot
  actPending: boolean
  onAction: (slug: string, action: string) => void
  sseLive?: boolean
}

/** Whole-card hit target to open details; action buttons sit above the link. */
export function ServiceCard({ group, svc, selected, activity, actPending, onAction, sseLive }: Props) {
  const st = statusLabel(svc)
  const building = isBuilding(svc)
  const queued = isQueued(svc)
  const liveHere = activityMatchesService(activity, group, svc.slug) && activity.active
  const busy = building || liveHere
  const waiting = queued && !busy
  const queuePos = (activity.queue || []).find((q) => q.group === group && q.slug === svc.slug)?.position
  const TypeIcon = serviceTypeIcon(svc.type)
  const name = svc.name || svc.slug
  const to = `/projects/${encodeURIComponent(group)}/${encodeURIComponent(svc.slug)}`
  const statusText =
    liveHere && activity.progress?.label
      ? activity.progress.label
      : waiting && queuePos
        ? `Queued #${queuePos}`
        : st.text
  const tone = statusTone(svc, { busy, waiting })
  const locked = busy || waiting
  const managed = svc.type === 'go' || svc.type === 'redis'
  const showUsage = svc.running && !!svc.stats
  const badge = busy ? 'badge-info' : waiting ? 'badge-warning' : st.badge

  return (
    <article
      className={[
        'group relative isolate h-full rounded-box border bg-base-100 shadow-sm',
        'transition-[border-color,background-color,box-shadow,transform] duration-200',
        'motion-safe:hover:-translate-y-px hover:border-primary/50 hover:bg-primary/[0.03] hover:shadow-md',
        'has-[a:focus-visible]:border-primary/50 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-primary/15',
        selected ? 'border-primary ring-2 ring-primary/20 bg-primary/[0.04]' : statusBorder(tone),
      ].join(' ')}
    >
      <Link
        to={to}
        className="absolute inset-0 z-0 rounded-box focus:outline-none focus-visible:outline-none"
        aria-label={`Open ${name}`}
      />

      <div className="relative z-[1] grid gap-2.5 p-3 pointer-events-none">
        <div className="flex gap-2.5 items-start min-w-0">
          <div className={iconWell(tone, 'sm')}>
            <TypeIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-2 items-start">
              <strong className="text-sm truncate leading-snug inline-flex items-center gap-1.5 min-w-0">
                <span className={`status ${statusDot(tone)} shrink-0`} aria-hidden />
                <span className="truncate">{name}</span>
              </strong>
              <span className={`badge badge-sm shrink-0 gap-1 ${badge}`}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                {statusText}
              </span>
            </div>
            <p className={`text-xs mt-0.5 m-0 truncate ${muted}`}>
              <span className="font-mono">{svc.type}</span>
              {svc.port ? ` · :${svc.port}` : ''}
              {svc.repo ? ` · ${svc.repo.split('/').pop()}` : ''}
            </p>
          </div>
        </div>

        {showUsage ? (
          <ServiceUsage
            compact
            live={sseLive}
            stats={svc.stats}
            fallbackMem={svc.memory_mb}
            fallbackCpu={svc.cpus}
          />
        ) : null}

        {managed ? (
          <div
            className="flex flex-wrap gap-1 min-h-8 items-center pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {svc.running ? (
              <Button
                variant="dangerSoft"
                icon={<CircleStop className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
                loading={actPending}
                disabled={locked}
                aria-label={`Stop ${svc.slug}`}
                title={locked ? 'Unavailable while deploying' : 'Stop'}
                onClick={() => onAction(svc.slug, 'stop')}
              />
            ) : (
              <Button
                variant="successSoft"
                icon={<Play className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
                loading={actPending}
                disabled={locked}
                aria-label={`Start ${svc.slug}`}
                title={locked ? 'Unavailable while deploying' : 'Start'}
                onClick={() => onAction(svc.slug, 'start')}
              />
            )}
            <Button
              variant="warningSoft"
              icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
              loading={actPending}
              disabled={locked}
              aria-label={`${svc.type === 'redis' ? 'Restart' : 'Redeploy'} ${svc.slug}`}
              title={svc.type === 'redis' ? 'Restart' : waiting ? 'Already queued' : busy ? 'Deploy in progress' : 'Redeploy'}
              onClick={() => onAction(svc.slug, svc.type === 'redis' ? 'restart' : 'redeploy')}
            />
          </div>
        ) : null}
      </div>
    </article>
  )
}
