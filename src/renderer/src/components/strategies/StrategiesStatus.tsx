import type { JSX } from 'react'
import type { StrategiesState } from '@renderer/hooks/useStrategies'
import styles from './Strategies.module.css'

// Restrained loading / error states for the persisted Strategies. An error is
// shown as an error — it is never replaced by fixtures or an empty list.
export function StrategiesStatus({
  state,
  onRetry
}: {
  state: Exclude<StrategiesState, { status: 'ready' }>
  onRetry: () => void
}): JSX.Element {
  if (state.status === 'loading') {
    return <div className={styles.empty}>Loading Strategies…</div>
  }
  return (
    <div className={styles.empty} role="alert">
      <div className={styles.fieldError}>Strategies could not be loaded.</div>
      <div>{state.message}</div>
      <button type="button" className={styles.buttonSecondary} onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
