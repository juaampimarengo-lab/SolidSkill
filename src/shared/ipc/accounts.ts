/**
 * Accounts IPC contract (Checkpoint 012B-3): the minimum the renderer needs to
 * list persisted trading accounts and choose the ACTIVE one. Display-level
 * only — no source login, server, credentials, or raw broker metadata cross
 * this boundary (docs/ACTIVE_ACCOUNT.md). Identity is the persisted Solid Skill
 * account id, never the display name.
 */

import type { IpcResult } from './result'
import type { AccountDto } from './trades'

export interface AccountListDto {
  /** Selectable (non-archived) accounts, oldest first. */
  accounts: AccountDto[]
  /** Resolved active account id (remembered choice, else deterministic fallback); null only when there are no accounts. */
  activeAccountId: string | null
}

export interface AccountsApi {
  list(): Promise<IpcResult<AccountListDto>>
  /** Remembers the choice locally. Never touches trade data or a broker. */
  setActive(accountId: string): Promise<IpcResult<AccountListDto>>
}

export const ACCOUNT_CHANNELS = {
  list: 'accounts:list',
  setActive: 'accounts:setActive'
} as const

export type AccountChannel = (typeof ACCOUNT_CHANNELS)[keyof typeof ACCOUNT_CHANNELS]
