import { createContext, useContext, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'
import { muted } from '@/lib/ui'

const FieldContext = createContext<{ id: string; description?: string } | null>(null)

type FieldProps = {
  label: string
  meta?: string
  tip?: string
  children?: ReactNode
  htmlFor?: string
  className?: string
}

export function Field({ label, meta, tip, children, htmlFor, className = '' }: FieldProps) {
  const generatedId = useId()
  const id = htmlFor || generatedId
  return (
    <FieldContext.Provider value={{ id, description: tip ? `${id}-tip` : undefined }}>
    <fieldset className={`fieldset p-0 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="label p-0 text-sm font-semibold">
          {label}
        </label>
        {meta ? <span className={`text-xs ${muted}`}>{meta}</span> : null}
      </div>
      {children}
      {tip ? <p id={`${id}-tip`} className={`text-xs ${muted} m-0 mt-1`}>{tip}</p> : null}
    </fieldset>
    </FieldContext.Provider>
  )
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const field = useContext(FieldContext)
  return <input id={field?.id} aria-describedby={field?.description} className={`input w-full ${className}`} {...rest} />
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useContext(FieldContext)
  return <textarea id={field?.id} aria-describedby={field?.description} className={`textarea w-full font-mono text-xs min-h-28 ${className}`} {...rest} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useContext(FieldContext)
  return (
    <select id={field?.id} aria-describedby={field?.description} className={`select w-full ${className}`} {...rest}>
      {children}
    </select>
  )
}
