import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'
import { muted } from '@/lib/ui'

type FieldProps = {
  label: string
  meta?: string
  tip?: string
  children?: ReactNode
  htmlFor?: string
  className?: string
}

export function Field({ label, meta, tip, children, htmlFor, className = '' }: FieldProps) {
  return (
    <fieldset className={`fieldset p-0 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={htmlFor} className="label p-0 text-sm font-semibold">
          {label}
        </label>
        {meta ? <span className={`text-xs ${muted}`}>{meta}</span> : null}
      </div>
      {children}
      {tip ? <p className={`text-xs ${muted} m-0 mt-1`}>{tip}</p> : null}
    </fieldset>
  )
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input w-full ${className}`} {...rest} />
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea w-full font-mono text-xs min-h-28 ${className}`} {...rest} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select w-full ${className}`} {...rest}>
      {children}
    </select>
  )
}
