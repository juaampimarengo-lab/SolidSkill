import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountListDto } from '@shared/ipc/accounts'
import type { AccountDto } from '@shared/ipc/trades'
import { createLatestGate } from '@renderer/lib/latest'
import type { Loadable } from './useTrading'

// The active account is a persisted Solid Skill account id, resolved and
// remembered by the main process (docs/ACTIVE_ACCOUNT.md). This hook mirrors
// it: selection is applied immediately, persisted in the background, and only
// the newest selection may reconcile the result. No fixture fallback.

export interface AccountsData {
  accounts: AccountDto[]
  activeAccountId: string | null
}

export interface UseAccounts {
  state: Loadable<AccountsData>
  select: (accountId: string) => void
  retry: () => void
}

export function useAccounts(): UseAccounts {
  const [state, setState] = useState<Loadable<AccountsData>>({ status: 'loading' })
  const gate = useRef(createLatestGate())
  const confirmed = useRef<string | null>(null)

  const load = useCallback((): void => {
    const api = window.solidSkill?.accounts
    if (!api) {
      setState({ status: 'error', message: 'Accounts are unavailable: the application bridge did not load.' })
      return
    }
    const isLatest = gate.current.begin()
    setState({ status: 'loading' })
    api
      .list()
      .then((result) => {
        if (!isLatest()) return
        if (!result.ok) return setState({ status: 'error', message: result.error.message, code: result.error.code })
        confirmed.current = result.data.activeAccountId
        setState({ status: 'ready', data: toData(result.data) })
      })
      .catch(() => {
        if (isLatest()) setState({ status: 'error', message: 'The request could not be completed.' })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const select = useCallback((accountId: string): void => {
    const api = window.solidSkill?.accounts
    if (!api) return
    const isLatest = gate.current.begin()
    setState((s) =>
      s.status === 'ready' && s.data.accounts.some((a) => a.id === accountId)
        ? { status: 'ready', data: { ...s.data, activeAccountId: accountId } }
        : s
    )
    const revert = (): void => {
      if (!isLatest()) return
      setState((s) => (s.status === 'ready' ? { status: 'ready', data: { ...s.data, activeAccountId: confirmed.current } } : s))
    }
    api
      .setActive(accountId)
      .then((result) => {
        if (!isLatest()) return // a newer choice superseded this one
        if (!result.ok) return revert()
        confirmed.current = result.data.activeAccountId
        setState({ status: 'ready', data: toData(result.data) })
      })
      .catch(revert)
  }, [])

  return { state, select, retry: load }
}

function toData(dto: AccountListDto): AccountsData {
  return { accounts: dto.accounts, activeAccountId: dto.activeAccountId }
}
