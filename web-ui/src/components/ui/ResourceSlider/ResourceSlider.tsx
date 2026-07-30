import { muted } from '@/lib/ui'
import { RESOURCE } from '@/lib/resources'

type Props = {
  id: string
  label: string
  tip?: string
  meta?: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (n: number) => void
  disabled?: boolean
  /** Live usage (same unit as value) — draws a smooth fill under the limit thumb. */
  liveValue?: number | null
}

/** Range + numeric input for memory/CPU with optional live usage fill. */
export function ResourceSlider({
  id,
  label,
  tip,
  meta,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
  disabled,
  liveValue,
}: Props) {
  const span = max - min
  const livePct =
    liveValue != null && span > 0
      ? Math.max(0, Math.min(100, ((liveValue - min) / span) * 100))
      : null
  const limitPct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0

  return (
    <fieldset className="fieldset p-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="label p-0 text-sm font-semibold">
          {label}
        </label>
        {meta ? <span className={`text-xs ${muted}`}>{meta}</span> : null}
      </div>
      <div className="grid gap-2">
        <div className="relative h-5 flex items-center">
          <div className="absolute inset-x-0 h-1.5 rounded-full bg-base-300 overflow-hidden pointer-events-none">
            {livePct != null ? (
              <div
                className="usage-fill absolute inset-y-0 left-0 rounded-full bg-info/55"
                style={{ width: `${livePct}%` }}
                title={`Live ${liveValue}${unit}`}
              />
            ) : null}
            <div
              className="usage-fill absolute inset-y-0 left-0 rounded-full bg-primary/25"
              style={{ width: `${limitPct}%` }}
            />
          </div>
          <input
            id={id}
            type="range"
            className="range range-primary range-xs relative z-[1] bg-transparent [--range-shdw:transparent]"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="input input-sm w-24"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) onChange(n)
            }}
            aria-label={label}
          />
          <span className={`text-xs ${muted}`}>
            {unit} · {min}–{max}
            {unit}
            {liveValue != null ? (
              <span className="text-info"> · live {Math.round(liveValue * 10) / 10}{unit}</span>
            ) : null}
          </span>
        </div>
      </div>
      {tip ? <p className={`text-xs ${muted} m-0 mt-1`}>{tip}</p> : null}
    </fieldset>
  )
}

export function clampMem(n: number): number {
  return Math.min(RESOURCE.memMax, Math.max(RESOURCE.memMin, Math.round(n) || RESOURCE.memDefault))
}

export function clampCpu(n: number): number {
  const x = Math.min(RESOURCE.cpuMax, Math.max(RESOURCE.cpuMin, n || RESOURCE.cpuDefault))
  return Math.round(x * 10) / 10
}
