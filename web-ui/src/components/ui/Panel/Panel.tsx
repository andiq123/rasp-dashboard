import type { ReactNode } from 'react'
import styles from './Panel.module.css'

type Props = {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}

export function Panel({ title, hint, children, className, id }: Props) {
  return (
    <section id={id} className={[styles.panel, className].filter(Boolean).join(' ')}>
      {(title || hint) && (
        <div className={styles.head}>
          <h2>{title}</h2>
          {hint ? <span className={styles.hint}>{hint}</span> : null}
        </div>
      )}
      {children}
    </section>
  )
}
