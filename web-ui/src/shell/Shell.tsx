import { NavLink } from 'react-router-dom'
import styles from './Shell.module.css'

const items = [
  { to: '/overview', label: 'Overview', end: true },
  { to: '/projects', label: 'Projects' },
  { to: '/files', label: 'Files' },
  { to: '/settings', label: 'Settings' },
] as const

export function Rail() {
  return (
    <nav className={styles.rail} aria-label="Main navigation">
      <div className={styles.railBrand}>FW</div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={'end' in item ? item.end : false}
          className={({ isActive }) => `${styles.railItem} ${isActive ? styles.active : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function Topbar({ live }: { live: boolean }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <h1>FireWifi</h1>
        <p>Pi hotspot</p>
      </div>
      <div className={styles.live}>
        <span className={`${styles.pulse} ${live ? '' : styles.off}`} />
        <span>{live ? 'Live' : 'Connecting'}</span>
      </div>
    </header>
  )
}
