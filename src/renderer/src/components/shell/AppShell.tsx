import type { JSX, ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar, type Representation } from './Topbar'
import styles from './AppShell.module.css'

interface AppShellProps {
  active: string
  onSelect: (label: string) => void
  representation: Representation
  onChangeRepresentation: (representation: Representation) => void
  children: ReactNode
}

export function AppShell({
  active,
  onSelect,
  representation,
  onChangeRepresentation,
  children
}: AppShellProps): JSX.Element {
  return (
    <div className={styles.shell}>
      <Sidebar active={active} onSelect={onSelect} />
      <div className={styles.main}>
        <Topbar pageTitle={active} representation={representation} onChangeRepresentation={onChangeRepresentation} />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  )
}
