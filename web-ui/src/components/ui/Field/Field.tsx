import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'
import styles from './Field.module.css'

type Props = {
  label: string
  meta?: string
  tip?: string
  children?: ReactNode
  htmlFor?: string
}

export function Field({ label, meta, tip, children, htmlFor }: Props) {
  return (
    <label className={styles.field} htmlFor={htmlFor}>
      <span className={styles.head}>
        <span className={styles.label}>{label}</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </span>
      {children}
      {tip ? <span className={styles.tip}>{tip}</span> : null}
    </label>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...rest }: InputProps) {
  return <input className={[styles.input, className].filter(Boolean).join(' ')} {...rest} />
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function TextArea({ className, ...rest }: TextAreaProps) {
  return <textarea className={[styles.textarea, className].filter(Boolean).join(' ')} {...rest} />
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={[styles.input, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  )
}
