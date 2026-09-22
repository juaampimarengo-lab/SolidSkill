import type { IpcResult } from '../../shared/ipc/result'
import { ACCOUNT_CHANNELS } from '../../shared/ipc/accounts'
import type { AccountChannel } from '../../shared/ipc/accounts'
import type { AccountService } from '../accounts/accountService'
import { ServiceError } from '../serviceError'
import { id } from './validation'

export type AccountHandler = (payload: unknown) => IpcResult<unknown>

export interface AccountHandlerDeps {
  /** null when the database failed to initialize; every call then reports PERSISTENCE_UNAVAILABLE. */
  getService: () => AccountService | null
  log: (message: string, error: unknown) => void
}

export function createAccountHandlers(deps: AccountHandlerDeps): Record<AccountChannel, AccountHandler> {
  function run<T>(fn: (service: AccountService) => T): IpcResult<T> {
    const service = deps.getService()
    if (service === null) {
      return {
        ok: false,
        error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'The local database could not be opened, so accounts cannot be loaded.' }
      }
    }
    try {
      return { ok: true, data: fn(service) }
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, error: { code: error.code, message: error.message } }
      deps.log('unexpected error in account handler', error)
      return { ok: false, error: { code: 'INTERNAL', message: 'An unexpected error occurred.' } }
    }
  }

  const C = ACCOUNT_CHANNELS
  return {
    [C.list]: () => run((s) => s.list()),
    [C.setActive]: (p) => run((s) => s.setActive(id(p, 'Account id')))
  }
}
