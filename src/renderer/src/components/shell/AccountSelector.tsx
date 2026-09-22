import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { UseAccounts } from '@renderer/hooks/useAccounts'
import styles from './AccountSelector.module.css'

// Minimal active-account control (docs/ACTIVE_ACCOUNT.md). Shows persisted
// display names only; the value it acts on is the Solid Skill account id.
export function AccountSelector({ accounts }: { accounts: UseAccounts }): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const { state } = accounts

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (state.status !== 'ready' || state.data.accounts.length === 0) {
    const label =
      state.status === 'loading' ? 'Loading…' : state.status === 'error' ? 'Accounts unavailable' : 'No accounts'
    return (
      <button
        type="button"
        className={styles.trigger}
        disabled
        title={state.status === 'error' ? state.message : undefined}
      >
        <span className={styles.placeholder}>{label}</span>
      </button>
    )
  }

  const { accounts: list, activeAccountId } = state.data
  const active = list.find((a) => a.id === activeAccountId) ?? null

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={active?.displayName}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.name}>{active?.displayName ?? 'Select account'}</span>
        {active && <span className={styles.currency}>{active.currency}</span>}
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>
      {open && (
        <ul className={styles.menu} id={listId} role="listbox" aria-label="Active account">
          {list.map((account) => {
            const selected = account.id === activeAccountId
            return (
              <li key={account.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={selected ? `${styles.option} ${styles.optionSelected}` : styles.option}
                  title={account.displayName}
                  onClick={() => {
                    setOpen(false)
                    if (!selected) accounts.select(account.id)
                  }}
                >
                  <span className={styles.check}>{selected && <Check size={12} strokeWidth={2} />}</span>
                  <span className={styles.optionName}>{account.displayName}</span>
                  <span className={styles.currency}>{account.currency}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
