import { Gamepad2, Laptop, MonitorSmartphone, Smartphone, Tablet, Tv, Watch, type LucideIcon } from 'lucide-react'

export type DeviceKind = { label: string; icon: LucideIcon }

const kinds: [RegExp, DeviceKind][] = [
  [/watch/i, { label: 'Watch', icon: Watch }],
  [/ipad|tab|tablet|kindle/i, { label: 'Tablet', icon: Tablet }],
  [/iphone|android|galaxy|pixel|redmi|xiaomi|oneplus|huawei|honor|oppo|vivo|motorola|moto|nokia|phone|cmd-rom/i, { label: 'Phone', icon: Smartphone }],
  [/tv|roku|chromecast|fire[-_ ]?stick|aft|bravia|webos|tizen|shield/i, { label: 'TV', icon: Tv }],
  [/playstation|ps[45]|xbox|switch|nintendo|steamdeck/i, { label: 'Console', icon: Gamepad2 }],
  [/macbook|imac|mac-?mini|laptop|desktop|thinkpad|surface|win|pc\b|notebook|ubuntu|linux/i, { label: 'Computer', icon: Laptop }],
]

/** Best guess at what a device is from its DHCP name; unknown names get a neutral icon. */
export function deviceKind(name?: string): DeviceKind {
  if (name) for (const [re, kind] of kinds) if (re.test(name)) return kind
  return { label: 'Device', icon: MonitorSmartphone }
}

export function fmtDuration(seconds = 0): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** 0–4 bars from RSSI. */
export function signalBars(dbm?: number): number {
  if (!dbm) return 0
  if (dbm >= -55) return 4
  if (dbm >= -65) return 3
  if (dbm >= -75) return 2
  return 1
}
