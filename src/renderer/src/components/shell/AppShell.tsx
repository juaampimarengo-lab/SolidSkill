import type { JSX, ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar, type Representation } from './Topbar'
import type { UseAccounts } from '@renderer/hooks/useAccounts'
import styles from './AppShell.module.css'

interface AppShellProps {
  active: string
  // Defaults to `active` (the sidebar section name). Overridden when a
  // contextual overlay (Day Review / Trade Review) is open on top of that
  // section — the sidebar highlight stays on the origin section while the
  // topbar title reflects the overlay instead. See CLAUDE.md checkpoint
  // instructions, "GOAL 1 — CONTEXTUAL PAGE TITLE."
  pageTitle?: string
  onSelect: (label: string) => void
  accounts: UseAccounts
  representation: Representation
  onChangeRepresentation: (representation: Representation) => void
  children: ReactNode
}

export function AppShell({
  active,
  pageTitle,
  onSelect,
  accounts,
  representation,
  onChangeRepresentation,
  children
}: AppShellProps): JSX.Element {
  return (
    <div className={styles.shell}>
      <Sidebar active={active} onSelect={onSelect} />
      <div className={styles.main}>
        <Topbar
          pageTitle={pageTitle ?? active}
          accounts={accounts}
          representation={representation}
          onChangeRepresentation={onChangeRepresentation}
        />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  )
}
