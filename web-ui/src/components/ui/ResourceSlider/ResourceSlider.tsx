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
}

/** Range + numeric input for memory/CPU with live meta. */
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
}: Props) {
  return (
    <fieldset className="fieldset p-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="label p-0 text-sm font-semibold">
          {label}
        </label>
        {meta ? <span className={`text-xs ${muted}`}>{meta}</span> : null}
      </div>
      <div className="grid gap-2">
        <input
          id={id}
          type="range"
          className="range range-primary range-xs"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
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
