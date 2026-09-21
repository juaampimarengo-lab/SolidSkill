import type { JSX } from 'react'
import styles from './DataStatus.module.css'

// Restrained loading / error state for persisted trading data. An error is
// shown as an error — it is never replaced by fixtures or an empty table.
export function DataStatus({
  what,
  state,
  onRetry
}: {
  what: string
  state: { status: 'loading' } | { status: 'error'; message: string }
  onRetry?: () => void
}): JSX.Element {
  if (state.status === 'loading') {
    return <div className={styles.status}>Loading {what}…</div>
  }
  return (
    <div className={styles.status} role="alert">
      <div className={styles.error}>{what} could not be loaded.</div>
      <div>{state.message}</div>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
