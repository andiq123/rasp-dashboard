import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

type Variant = 'default' | 'primary' | 'quiet' | 'danger' | 'dangerSoft'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'default',
  loading,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: Props) {
  const cls = [
    styles.btn,
    variant === 'primary' && styles.primary,
    variant === 'quiet' && styles.quiet,
    variant === 'danger' && styles.danger,
    variant === 'dangerSoft' && styles.dangerSoft,
    loading && styles.loading,
    (icon || loading) && styles.hasIco,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      <span className={styles.spinner} aria-hidden="true" />
      {icon}
      {children != null && <span>{children}</span>}
    </button>
  )
}
