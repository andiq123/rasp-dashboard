/** Shared log-line coloring for deploy activity + runtime container logs. */

export type LogLineView = {
  key: string
  level: string
  text: string
  at?: string
}

/** Canonical levels from the activity hub: step | info | cmd | out | ok | warn | err */
export function normalizeLogLevel(raw: string): string {
  const l = String(raw || '')
    .trim()
    .toLowerCase()
  switch (l) {
    case 'err':
    case 'error':
    case 'fatal':
    case 'panic':
      return 'err'
    case 'warn':
    case 'warning':
      return 'warn'
    case 'ok':
    case 'success':
      return 'ok'
    case 'step':
      return 'step'
    case 'cmd':
    case 'command':
      return 'cmd'
    case 'info':
      return 'info'
    case 'out':
    case 'stdout':
    case 'debug':
    case 'trace':
    case 'section':
      return 'out'
    default:
      return l || 'out'
  }
}

/** Daisy semantic text colors — one class per level. */
export function logLevelClass(level: string): string {
  switch (normalizeLogLevel(level)) {
    case 'err':
      return 'text-error'
    case 'warn':
      return 'text-warning'
    case 'ok':
      return 'text-success'
    case 'step':
      return 'text-primary font-semibold'
    case 'cmd':
      return 'text-secondary'
    case 'info':
      return 'text-info'
    default:
      return 'text-base-content/75'
  }
}

export function activityToLogLines(
  lines: Array<{ seq?: number; level: string; text: string; at?: string }>,
  keyPrefix = 'a',
): LogLineView[] {
  return lines.map((l, i) => ({
    key: `${keyPrefix}-${l.seq ?? i}`,
    level: normalizeLogLevel(l.level),
    text: l.text,
    at: l.at,
  }))
}

/** Infer level from a raw container/runtime log line. */
export function inferLogLevel(line: string): string {
  const trimmed = line.trimStart()
  const bracket = trimmed.match(/^\[([a-zA-Z]+)\]/)
  if (bracket) return normalizeLogLevel(bracket[1])

  // Go slog / logfmt: time=… level=INFO msg="…"
  const slog = trimmed.match(/\b(?:level|lvl)=(?:"([^"]+)"|'([^']+)'|([A-Za-z]+))/i)
  if (slog) return normalizeLogLevel(slog[1] || slog[2] || slog[3] || '')

  // JSON-ish: "level":"info" or "severity":"error"
  const jsonLvl = trimmed.match(/"(?:level|severity|severityname)"\s*:\s*"([A-Za-z]+)"/i)
  if (jsonLvl) return normalizeLogLevel(jsonLvl[1])

  // Timestamp-prefixed lines: 2026-07-27T… INFO …
  const tagged = trimmed.match(
    /^\d{4}[-/]\d{2}[-/]\d{2}[ T].*?\b(ERROR|WARN|WARNING|INFO|DEBUG|FATAL)\b/i,
  )
  if (tagged) return normalizeLogLevel(tagged[1])

  if (/\b(ERROR|FATAL|panic:)\b/i.test(trimmed)) return 'err'
  if (/\b(WARN(?:ING)?)\b/i.test(trimmed)) return 'warn'
  if (/\bINFO\b/i.test(trimmed)) return 'info'
  if (/\bDEBUG\b/i.test(trimmed)) return 'out'
  return 'out'
}

export function textToLogLines(text: string, keyPrefix = 't'): LogLineView[] {
  if (!text) return []
  return text.split(/\r?\n/).map((line, i) => ({
    key: `${keyPrefix}-${i}`,
    level: inferLogLevel(line),
    text: line,
  }))
}
