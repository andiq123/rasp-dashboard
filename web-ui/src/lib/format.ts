export function fmtPct(n: number | undefined | null): string {
  const v = Number(n) || 0
  return `${Math.round(v)}%`
}

export function fmtBytes(n: number | undefined | null): string {
  let v = Number(n) || 0
  if (v < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  // Step up before rounding could print "1024 KB".
  while (Math.round(v) >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  if (i === 0 || v >= 100) return `${Math.round(v)} ${units[i]}`
  return `${v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`
}

export function fmtRate(n: number | undefined | null): string {
  const v = Number(n) || 0
  if (v < 0) return '—'
  return `${fmtBytes(v)}/s`
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
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}
