import { useState, type JSX } from 'react'
import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import type { UseAccounts } from '@renderer/hooks/useAccounts'
import { AccountSelector } from './AccountSelector'
import styles from './Topbar.module.css'

export const representations = ['$', '%', 'R', 'PTS'] as const
export type Representation = (typeof representations)[number]

interface TopbarProps {
  pageTitle: string
  accounts: UseAccounts
  representation: Representation
  onChangeRepresentation: (representation: Representation) => void
}

export function Topbar({ pageTitle, accounts, representation, onChangeRepresentation }: TopbarProps): JSX.Element {
  const [privacyOn, setPrivacyOn] = useState(false)

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <h1 className={styles.pageTitle}>{pageTitle}</h1>
      </div>

      <div className={styles.right}>
        <AccountSelector accounts={accounts} />

        <button type="button" className={styles.dateRange}>
          <span>This Week</span>
          <ChevronDown size={14} strokeWidth={1.75} />
        </button>

        <div className={styles.segmented} role="tablist" aria-label="Data representation">
          {representations.map((token) => (
            <button
              key={token}
              type="button"
              role="tab"
              aria-selected={representation === token}
              className={representation === token ? `${styles.segment} ${styles.segmentActive}` : styles.segment}
              onClick={() => onChangeRepresentation(token)}
            >
              {token}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles.iconButton}
          aria-pressed={privacyOn}
          aria-label="Toggle privacy mode"
          onClick={() => setPrivacyOn((v) => !v)}
        >
          {privacyOn ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
        </button>
      </div>
    </header>
  )
}
