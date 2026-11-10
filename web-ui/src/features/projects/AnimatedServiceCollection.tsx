import { useEffect, useLayoutEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import type { Service } from '@/api/types'

const EXIT_MS = 220
const ENTER_MS = 320
const MOVE_MS = 380
const moveEase = 'cubic-bezier(0.22, 1, 0.36, 1)'

type Props = {
  services: Service[]
  children: (service: Service) => ReactNode
  className?: string
  itemClassName?: string
  empty?: ReactNode
  as?: 'div' | 'nav'
  ariaLabel?: string
}

type Leaving = { service: Service; index: number }

/**
 * Renders `services` directly, so live stat ticks cost one render. Only when
 * membership changes does it keep removed cards mounted to fade out, mark new
 * ones to rise in, and FLIP the survivors into their new positions.
 */
export function AnimatedServiceCollection({
  services,
  children,
  className = '',
  itemClassName = '',
  empty,
  as = 'div',
  ariaLabel,
}: Props) {
  const [leaving, setLeaving] = useState<Leaving[]>([])
  const [entering, setEntering] = useState<ReadonlySet<string>>(() => new Set())
  const previous = useRef(services)
  const timers = useRef(new Set<number>())
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const rects = useRef(new Map<string, DOMRect>())
  const Tag = as as ElementType
  const membership = services.map((s) => s.slug).join('\u0000')

  useLayoutEffect(() => {
    const before = previous.current
    previous.current = services
    const now = new Set(services.map((s) => s.slug))
    const was = new Set(before.map((s) => s.slug))
    const removed = before.flatMap((service, index) => (now.has(service.slug) ? [] : [{ service, index }]))
    const added = services.filter((s) => !was.has(s.slug)).map((s) => s.slug)
    const later = (ms: number, fn: () => void) => {
      const t = window.setTimeout(() => {
        timers.current.delete(t)
        fn()
      }, ms)
      timers.current.add(t)
    }
    // A service that came back cancels its own exit.
    setLeaving((v) => (v.some((l) => now.has(l.service.slug)) || removed.length
      ? [...v.filter((l) => !now.has(l.service.slug)), ...removed]
      : v))
    if (removed.length) later(EXIT_MS, () => setLeaving((v) => v.filter((l) => !removed.includes(l))))
    if (added.length) {
      setEntering((v) => new Set([...v, ...added]))
      later(ENTER_MS, () => setEntering((v) => new Set([...v].filter((slug) => !added.includes(slug)))))
    }
  }, [membership]) // eslint-disable-line react-hooks/exhaustive-deps -- stat ticks replace `services` without changing membership

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) window.clearTimeout(t)
    }
  }, [])

  // Exiting cards stay near where they were until their fade ends.
  const items: Array<{ service: Service; leaving: boolean }> = services.map((service) => ({ service, leaving: false }))
  for (const l of [...leaving].sort((a, b) => a.index - b.index)) {
    if (!items.some((i) => i.service.slug === l.service.slug)) {
      items.splice(Math.min(l.index, items.length), 0, { service: l.service, leaving: true })
    }
  }
  const layout = items.map((i) => `${i.service.slug}${i.leaving ? '!' : ''}`).join('\u0000')

  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, DOMRect>()
    for (const [slug, node] of nodes.current) next.set(slug, node.getBoundingClientRect())
    if (!reduceMotion) {
      for (const [slug, rect] of next) {
        const old = rects.current.get(slug)
        if (!old) continue
        const x = old.left - rect.left
        const y = old.top - rect.top
        if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue
        nodes.current.get(slug)?.animate(
          [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }],
          { duration: MOVE_MS, easing: moveEase },
        )
      }
    }
    rects.current = next
  }, [layout])

  return (
    <Tag className={className} aria-label={ariaLabel}>
      {items.length === 0 && empty ? (
        <div className="service-empty-enter col-span-full">{empty}</div>
      ) : items.map(({ service, leaving: gone }) => (
        <div
          key={service.slug}
          ref={(node) => {
            if (node) nodes.current.set(service.slug, node)
            else nodes.current.delete(service.slug)
          }}
          className={`service-motion-item ${entering.has(service.slug) ? 'service-motion-enter' : ''} ${gone ? 'service-motion-exit' : ''} ${itemClassName}`}
          aria-hidden={gone || undefined}
          inert={gone || undefined}
        >
          {children(service)}
        </div>
      ))}
    </Tag>
  )
}
