import type { MullvadAccount } from '@/api/types'

export const MULLVAD_ACCOUNT_URL = 'https://mullvad.net/en/account'

export function daysLeftText(a?: MullvadAccount): string {
  if (!a?.configured) return 'Not tracked'
  if (a.days_left == null) return a.error ? 'Unknown' : 'Checking…'
  if (a.days_left < 0) return 'Expired'
  if (a.days_left === 0) return 'Ends today'
  return a.days_left === 1 ? '1 day left' : `${a.days_left} days left`
}

export function daysLeftTone(a?: MullvadAccount): 'ok' | 'warn' | 'bad' | undefined {
  if (a?.days_left == null) return undefined
  if (a.days_left <= 1) return 'bad'
  if (a.days_left <= 7) return 'warn'
  return 'ok'
}

export function expiryDate(a?: MullvadAccount): string {
  if (!a?.expires_at) return '—'
  return new Date(a.expires_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}
