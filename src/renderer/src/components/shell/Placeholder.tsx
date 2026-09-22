import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './Placeholder.module.css'

export function Placeholder(): JSX.Element {
  const { t } = useTranslation('shell')
  return <p className={styles.copy}>{t('placeholder')}</p>
}
