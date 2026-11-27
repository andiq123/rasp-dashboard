/**
 * Placeholder rows shaped like a panel's real content, so the panel keeps its
 * size when data arrives instead of jumping from one spinner line to full height.
 */
export function PanelSkeleton({ rows = 1, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="grid gap-1.5" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-row" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  )
}
