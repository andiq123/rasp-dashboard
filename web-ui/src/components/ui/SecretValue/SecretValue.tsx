import { useState } from 'react'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button/Button'
import { useToast } from '@/components/ui/Toast/Toast'
import { writeClipboardText } from '@/lib/clipboard'
import { codeSurface } from '@/lib/ui'

const SECRET_KEY = /PASS|SECRET|TOKEN|PRIVATE|_KEY\b|^KEY\b|DSN|URL/i

/** Hides the password part of a URL: scheme://user:••••••@host. */
export function maskUrl(value: string): string {
  return value.replace(/(\/\/[^:/@\s]+:)[^@\s]+@/g, '$1••••••@')
}

/** Masks secret values in KEY=VALUE lines; URLs keep everything but the password. */
export function maskEnv(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const i = line.indexOf('=')
      if (i <= 0) return line
      const key = line.slice(0, i)
      const value = line.slice(i + 1)
      if (!SECRET_KEY.test(key) || !value) return line
      return `${key}=${/:\/\//.test(value) ? maskUrl(value) : '••••••••'}`
    })
    .join('\n')
}

type Props = { value: string; kind?: 'url' | 'env'; label: string; className?: string }

/** Secret text: masked by default, with Show and Copy. Copy always copies the real value. */
export function SecretValue({ value, kind = 'url', label, className = '' }: Props) {
  const [shown, setShown] = useState(false)
  const { showToast } = useToast()
  const masked = kind === 'env' ? maskEnv(value) : maskUrl(value)
  return (
    <div className="secret">
      <pre className={`${codeSurface} ${className}`} aria-label={label}>{shown ? value : masked}</pre>
      <div className="secret-actions">
        <Button variant="quiet" icon={shown ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />} onClick={() => setShown((v) => !v)} aria-pressed={shown}>
          {shown ? 'Hide' : 'Show'}
        </Button>
        <Button
          variant="quiet"
          icon={<Copy className="h-3.5 w-3.5" aria-hidden />}
          onClick={async () => {
            try {
              await writeClipboardText(value)
              showToast(`${label} copied`)
            } catch {
              showToast('Could not copy', 'error')
            }
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  )
}
