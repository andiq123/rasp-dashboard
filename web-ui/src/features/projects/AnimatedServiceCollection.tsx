import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from 'react'
import type { Service } from '@/api/types'

const EXIT_MS = 420
const MOVE_MS = 560
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

/**
 * Keeps removed services mounted long enough to fade out, then applies FLIP
 * transforms so surviving cards glide into their new positions. No animation
 * package is required and reduced-motion preferences are respected.
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
  const [items, setItems] = useState<Service[]>(services)
  const [exiting, setExiting] = useState<Set<string>>(() => new Set())
  const itemsRef = useRef(items)
  const timers = useRef(new Map<string, number>())
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const previousRects = useRef(new Map<string, DOMRect>())
  const animations = useRef(new Map<string, Animation>())
  const Tag = as as ElementType

  useEffect(() => {
    const nextBySlug = new Map(services.map((service) => [service.slug, service]))
    const nextSlugs = new Set(nextBySlug.keys())

    for (const slug of nextSlugs) {
      const timer = timers.current.get(slug)
      if (timer != null) {
        window.clearTimeout(timer)
        timers.current.delete(slug)
      }
    }
    const current = itemsRef.current
    const removed = current.filter((service) => !nextSlugs.has(service.slug))
    const next = [...services]
    const nextExiting = new Set(removed.map((service) => service.slug))

    // Keep an exiting item near its old location until its fade completes.
    for (const service of removed) {
      const oldIndex = current.findIndex((item) => item.slug === service.slug)
      next.splice(Math.min(Math.max(oldIndex, 0), next.length), 0, service)
      if (!timers.current.has(service.slug)) {
        const timer = window.setTimeout(() => {
          timers.current.delete(service.slug)
          setItems((value) => {
            const updated = value.filter((item) => item.slug !== service.slug)
            itemsRef.current = updated
            return updated
          })
          setExiting((value) => {
            const updated = new Set(value)
            updated.delete(service.slug)
            return updated
          })
        }, EXIT_MS)
        timers.current.set(service.slug, timer)
      }
    }
    itemsRef.current = next
    setExiting(nextExiting)
    setItems(next)
  }, [services])

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer)
    for (const animation of animations.current.values()) animation.cancel()
  }, [])

  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nextRects = new Map<string, DOMRect>()
    for (const item of items) {
      const node = nodes.current.get(item.slug)
      if (node) nextRects.set(item.slug, node.getBoundingClientRect())
    }

    if (!reduceMotion) {
      for (const [slug, next] of nextRects) {
        const previous = previousRects.current.get(slug)
        const node = nodes.current.get(slug)
        if (!previous || !node || exiting.has(slug)) continue
        const x = previous.left - next.left
        const y = previous.top - next.top
        if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue
        animations.current.get(slug)?.cancel()
        const animation = node.animate(
          [
            { transform: `translate3d(${x}px, ${y}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          { duration: MOVE_MS, easing: moveEase },
        )
        animations.current.set(slug, animation)
        animation.onfinish = () => animations.current.delete(slug)
      }
    }
    previousRects.current = nextRects
  }, [items, exiting])

  return (
    <Tag className={className} aria-label={ariaLabel}>
      {items.length === 0 && empty ? (
        <div className="service-empty-enter col-span-full">{empty}</div>
      ) : items.map((service) => {
        const leaving = exiting.has(service.slug)
        return (
          <div
            key={service.slug}
            ref={(node) => {
              if (node) nodes.current.set(service.slug, node)
              else nodes.current.delete(service.slug)
            }}
            className={`service-motion-item service-motion-enter ${leaving ? 'service-motion-exit' : ''} ${itemClassName}`}
            aria-hidden={leaving || undefined}
            inert={leaving || undefined}
          >
            {children(service)}
          </div>
        )
      })}
    </Tag>
  )
}
