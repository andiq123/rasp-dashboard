import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

type Variant = 'default' | 'primary' | 'quiet' | 'danger' | 'dangerSoft'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  loading?: boolean
  icon?: ReactNode
  size?: 'sm' | 'md'
}

const variantClass: Record<Variant, string> = {
  default: 'btn-outline border-base-300',
  primary: 'btn-primary',
  quiet: 'btn-ghost',
  danger: 'btn-error btn-outline',
  dangerSoft: 'btn-error btn-soft',
}

export function Button({
  variant = 'default',
  loading,
  icon,
  size = 'sm',
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`btn ${size === 'sm' ? 'btn-sm' : ''} ${variantClass[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children != null ? <span>{children}</span> : null}
    </button>
  )
}
