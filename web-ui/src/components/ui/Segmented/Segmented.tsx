import { Loader2 } from 'lucide-react'

type Option<T extends string> = { value: T; label: string }

type Props<T extends string> = {
  label: string
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  /** Option currently being applied; shows a spinner in place. */
  pending?: T
  /** Hovering or focusing another option previews it (null when the pointer leaves). */
  onPreview?: (value: T | null) => void
}

/** Mutually exclusive choice with one sliding thumb. */
export function Segmented<T extends string>({ label, options, value, onChange, disabled, pending, onPreview }: Props<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      style={{ '--seg-count': options.length, '--seg-index': index } as React.CSSProperties}
    >
      <span className="segmented-thumb" aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="segmented-option"
          disabled={disabled}
          onClick={() => {
            onPreview?.(null)
            if (o.value !== value) onChange(o.value)
          }}
          onPointerEnter={() => o.value !== value && onPreview?.(o.value)}
          onPointerLeave={() => onPreview?.(null)}
          onFocus={() => o.value !== value && onPreview?.(o.value)}
          onBlur={() => onPreview?.(null)}
        >
          {pending === o.value ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {o.label}
        </button>
      ))}
    </div>
  )
}
