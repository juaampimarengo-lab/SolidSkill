import { useCallback, useEffect, useRef, useState } from 'react'
import i18n from '@renderer/i18n'
import type { Language } from '@shared/ipc/settings'
import { createLatestGate } from '@renderer/lib/latest'
import type { Loadable } from './useTrading'

// Mirrors useAccounts.ts: the language preference is resolved and remembered
// by the main process (docs/LOCALIZATION.md). i18next is already seeded with
// the correct value before first paint (window.solidSkill.initialLanguage);
// this hook keeps it in sync with the persisted preference and lets the user
// change it at runtime. Presentation state only — never touches trading data.

export interface UseLanguage {
  state: Loadable<Language>
  select: (language: Language) => void
}

export function useLanguage(): UseLanguage {
  const [state, setState] = useState<Loadable<Language>>({
    status: 'ready',
    data: window.solidSkill?.initialLanguage ?? 'en'
  })
  const gate = useRef(createLatestGate())
  const confirmed = useRef<Language>(window.solidSkill?.initialLanguage ?? 'en')

  const load = useCallback((): void => {
    const api = window.solidSkill?.settings
    if (!api) {
      setState({ status: 'error', message: 'Settings are unavailable: the application bridge did not load.' })
      return
    }
    const isLatest = gate.current.begin()
    api
      .getLanguage()
      .then((result) => {
        if (!isLatest()) return
        if (!result.ok) return setState({ status: 'error', message: result.error.message, code: result.error.code })
        confirmed.current = result.data.language
        setState({ status: 'ready', data: result.data.language })
        void i18n.changeLanguage(result.data.language)
      })
      .catch(() => {
        if (isLatest()) setState({ status: 'error', message: 'The request could not be completed.' })
      })
  }, [])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const select = useCallback((language: Language): void => {
    const api = window.solidSkill?.settings
    if (!api) return
    const isLatest = gate.current.begin()
    setState({ status: 'ready', data: language })
    void i18n.changeLanguage(language)
    const revert = (): void => {
      if (!isLatest()) return
      setState({ status: 'ready', data: confirmed.current })
      void i18n.changeLanguage(confirmed.current)
    }
    api
      .setLanguage(language)
      .then((result) => {
        if (!isLatest()) return
        if (!result.ok) return revert()
        confirmed.current = result.data.language
        setState({ status: 'ready', data: result.data.language })
      })
      .catch(revert)
  }, [])

  return { state, select }
}
