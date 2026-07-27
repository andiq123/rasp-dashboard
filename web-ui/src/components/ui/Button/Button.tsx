import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/** Semantic action colors — map intent, not decoration. */
export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'successSoft'
  | 'warning'
  | 'warningSoft'
  | 'info'
  | 'infoSoft'
  | 'quiet'
  | 'danger'
  | 'dangerSoft'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  loading?: boolean
  icon?: ReactNode
  size?: 'sm' | 'md'
}

const variantClass: Record<ButtonVariant, string> = {
  default: 'btn-outline border-base-300',
  primary: 'btn-primary',
  success: 'btn-success',
  successSoft: 'btn-success btn-soft',
  warning: 'btn-warning',
  warningSoft: 'btn-warning btn-soft',
  info: 'btn-info',
  infoSoft: 'btn-info btn-soft',
  quiet: 'btn-ghost',
  danger: 'btn-error',
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
