import { Link } from 'react-router-dom'
import { CircleStop, Loader2, Play, RotateCw } from 'lucide-react'
import type { ActivitySnapshot, Service } from '@/api/types'
import { Button } from '@/components/ui/Button/Button'
import { activityMatchesService } from '@/hooks/useActivity'
import { iconWell, muted } from '@/lib/ui'
import { isBuilding, isQueued, serviceTypeIcon, statusLabel } from './serviceStatus'

type Props = {
  group: string
  svc: Service
  selected: boolean
  activity: ActivitySnapshot
  actPending: boolean
  onAction: (slug: string, action: string) => void
}

/** Whole-card hit target to open details; action buttons sit above the link. */
export function ServiceCard({ group, svc, selected, activity, actPending, onAction }: Props) {
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
  const tone = busy ? 'success' : waiting ? 'warning' : svc.running ? 'success' : 'primary'
  const locked = busy || waiting
  const go = svc.type === 'go'

  return (
    <article
      className={[
        'group relative isolate rounded-box border bg-base-100 shadow-sm',
        'transition-[border-color,background-color,box-shadow] duration-200',
        'hover:border-primary/50 hover:bg-primary/[0.03] hover:shadow',
        'focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15',
        busy ? 'border-info/45' : waiting ? 'border-warning/45' : 'border-base-300',
        selected ? 'border-primary ring-2 ring-primary/20 bg-primary/[0.04]' : '',
      ].join(' ')}
    >
      <Link
        to={to}
        className="absolute inset-0 z-0 rounded-box focus:outline-none"
        aria-label={`Open ${name}`}
      />

      <div className="relative z-[1] grid gap-2 p-2.5 pointer-events-none">
        <div className="flex gap-2 items-start min-w-0">
          <div className={iconWell(tone, 'sm')}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <TypeIcon className="h-4 w-4" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-2 items-start">
              <strong className="text-sm truncate leading-snug">{name}</strong>
              <span
                className={`badge badge-sm shrink-0 gap-1 ${
                  busy ? 'badge-info' : waiting ? 'badge-warning' : st.badge
                }`}
              >
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

        {go ? (
          <div
            className="flex flex-wrap gap-1 min-h-8 items-center pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {svc.running ? (
              <Button
                variant="dangerSoft"
                icon={<CircleStop className="h-3.5 w-3.5" aria-hidden />}
                loading={actPending}
                disabled={locked}
                aria-label={`Stop ${svc.slug}`}
                title={locked ? 'Unavailable while deploying' : 'Stop'}
                onClick={() => onAction(svc.slug, 'stop')}
              />
            ) : (
              <Button
                variant="successSoft"
                icon={<Play className="h-3.5 w-3.5" aria-hidden />}
                loading={actPending}
                disabled={locked}
                aria-label={`Start ${svc.slug}`}
                title={locked ? 'Unavailable while deploying' : 'Start'}
                onClick={() => onAction(svc.slug, 'start')}
              />
            )}
            <Button
              variant="warningSoft"
              icon={<RotateCw className="h-3.5 w-3.5" aria-hidden />}
              loading={actPending}
              disabled={locked}
              aria-label={`Redeploy ${svc.slug}`}
              title={
                waiting
                  ? 'Already queued'
                  : busy
                    ? 'Deploy in progress'
                    : 'Redeploy'
              }
              onClick={() => onAction(svc.slug, 'redeploy')}
            />
          </div>
        ) : (
          <p className={`text-[11px] m-0 min-h-8 flex items-center ${muted}`}>Open details</p>
        )}
      </div>
    </article>
  )
}
