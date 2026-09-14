import type { JSX, ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import styles from './AppShell.module.css'

interface AppShellProps {
  active: string
  onSelect: (label: string) => void
  children: ReactNode
}

export function AppShell({ active, onSelect, children }: AppShellProps): JSX.Element {
  return (
    <div className={styles.shell}>
      <Sidebar active={active} onSelect={onSelect} />
      <div className={styles.main}>
        <Topbar pageTitle={active} />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  )
}
