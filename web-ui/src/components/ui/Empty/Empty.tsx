import type { ReactNode } from 'react'
import styles from './Empty.module.css'

type Props = {
  title: string
  body?: ReactNode
  action?: ReactNode
}

export function Empty({ title, body, action }: Props) {
  return (
    <div className={styles.empty}>
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  )
}
