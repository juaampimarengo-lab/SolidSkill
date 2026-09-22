import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enCommon from './locales/en/common.json'
import enShell from './locales/en/shell.json'
import enStrategy from './locales/en/strategy.json'
import enAccounts from './locales/en/accounts.json'
import esCommon from './locales/es/common.json'
import esShell from './locales/es/shell.json'
import esStrategy from './locales/es/strategy.json'
import esAccounts from './locales/es/accounts.json'

/**
 * Solid Skill localization foundation (Checkpoint 012C, docs/LOCALIZATION.md).
 * Resources are bundled with the app — no network, no runtime translation
 * service. English is both the default language and the fallback: a missing
 * Spanish key resolves to its English copy rather than showing a raw key or
 * blank UI. Only presentation copy lives here — user-created/imported data
 * and canonical trading terminology are never passed through `t()`.
 *
 * Initialized with the language read synchronously in the preload script
 * (`window.solidSkill.initialLanguage`) so the first render already shows the
 * right language — no flash back to English on reload/restart.
 */
void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, shell: enShell, strategy: enStrategy, accounts: enAccounts },
    es: { common: esCommon, shell: esShell, strategy: esStrategy, accounts: esAccounts }
  },
  lng: window.solidSkill?.initialLanguage ?? 'en',
  fallbackLng: 'en',
  ns: ['common', 'shell', 'strategy', 'accounts'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnEmptyString: false
})

export default i18n
