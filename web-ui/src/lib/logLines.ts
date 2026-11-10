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

// Colour codes and cursor movement from build tools; \r redraws keep only the last frame.
// oxlint-disable-next-line no-control-regex -- matching escape sequences is the point
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g

export function cleanLogText(text: string): string {
  const plain = text.includes('\u001b') ? text.replace(ANSI, '') : text
  const cr = plain.lastIndexOf('\r', plain.length - 2)
  return (cr >= 0 ? plain.slice(cr + 1) : plain).replace(/\r$/, '')
}

export function activityToLogLines(
  lines: Array<{ seq?: number; level: string; text: string; at?: string }>,
  keyPrefix = 'a',
): LogLineView[] {
  return lines.map((l, i) => ({
    key: `${keyPrefix}-${l.seq ?? i}`,
    level: normalizeLogLevel(l.level),
    text: cleanLogText(l.text),
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

  if (/\b(?:ERROR|FATAL)\b|\bpanic:/i.test(trimmed)) return 'err'
  if (/\b(WARN(?:ING)?)\b/i.test(trimmed)) return 'warn'
  if (/\bINFO\b/i.test(trimmed)) return 'info'
  return 'out'
}

export function textToLogLines(text: string, keyPrefix = 't'): LogLineView[] {
  if (!text) return []
  return text.replace(/\n$/, '').split('\n').map((raw, i) => {
    const line = cleanLogText(raw)
    return { key: `${keyPrefix}-${i}`, level: inferLogLevel(line), text: line }
  })
}
