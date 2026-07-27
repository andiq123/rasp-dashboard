export function fmtPct(n: number | undefined | null): string {
  const v = Number(n) || 0
  return `${Math.round(v)}%`
}

export function fmtBytes(n: number | undefined | null): string {
  let v = Number(n) || 0
  if (v < 0) return '—'
  if (v < 1024) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  v /= 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  if (v >= 100) return `${Math.round(v)} ${units[i]}`
  if (v >= 10) return `${v.toFixed(1)} ${units[i]}`
  return `${v.toFixed(2)} ${units[i]}`
}

export function fmtRate(n: number | undefined | null): string {
  const v = Number(n) || 0
  if (v < 1024) return `${Math.round(v)} B/s`
  return `${fmtBytes(v)}/s`.replace(' ', '')
}

export function fmtRelative(iso: string | undefined | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const sec = Math.round((Date.now() - t) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export function slugify(s: string): string {
  let out = String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (out && /^[0-9]/.test(out)) out = `app-${out}`
  return out.slice(0, 48)
}
