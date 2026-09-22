import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './DataStatus.module.css'

// Restrained loading / error state for persisted trading data. An error is
// shown as an error — it is never replaced by fixtures or an empty table.
// `what` (e.g. "Accounts", "Trades") is a canonical trading noun and is never
// translated; only the surrounding product copy is.
export function DataStatus({
  what,
  state,
  onRetry
}: {
  what: string
  state: { status: 'loading' } | { status: 'error'; message: string }
  onRetry?: () => void
}): JSX.Element {
  const { t } = useTranslation('common')
  if (state.status === 'loading') {
    return <div className={styles.status}>{t('loading', { what })}</div>
  }
  return (
    <div className={styles.status} role="alert">
      <div className={styles.error}>{t('couldNotBeLoaded', { what })}</div>
      <div>{state.message}</div>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t('retry')}
        </button>
      )}
    </div>
  )
}
