import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseLanguage } from '@renderer/hooks/useLanguage'
import type { Language } from '@shared/ipc/settings'
import { LANGUAGES } from '@shared/ipc/settings'
import styles from './Settings.module.css'

// Restrained: a single Language control on the Settings screen (Checkpoint
// 012C, docs/LOCALIZATION.md). Not a Settings redesign — just the minimum
// surface for the language preference to live on.
const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Español' }

export function SettingsWorkspace({ language }: { language: UseLanguage }): JSX.Element {
  const { t } = useTranslation('shell')
  const { state, select } = language

  return (
    <div className={styles.workspace}>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.title')}</h2>

        <div className={styles.row}>
          <span className={styles.label}>{t('settings.language.label')}</span>
          <div className={styles.segmented} role="radiogroup" aria-label={t('settings.language.label') ?? undefined}>
            {LANGUAGES.map((code) => {
              const active = state.status === 'ready' && state.data === code
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? `${styles.option} ${styles.optionActive}` : styles.option}
                  onClick={() => select(code)}
                >
                  {LANGUAGE_NAMES[code]}
                </button>
              )
            })}
          </div>
        </div>
        <p className={styles.helper}>{t('settings.language.helper')}</p>
      </div>
    </div>
  )
}
