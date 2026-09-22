import type { Database } from '../persistence'
import type { AccountListDto } from '../../shared/ipc/accounts'
import { ServiceError } from '../serviceError'
import type { ActiveAccountStore } from './activeAccountStore'

/**
 * Lists selectable accounts and resolves the active one. Read-only with
 * respect to the database: choosing an account only writes the local
 * preference file.
 *
 * Resolution: remembered id if it still names a selectable account; else the
 * first selectable account (oldest, deterministic); else null.
 */
export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly store: ActiveAccountStore
  ) {}

  list(): AccountListDto {
    const accounts = this.db.repositories.accounts.list().map((a) => ({
      id: a.id,
      displayName: a.displayName,
      currency: a.currency,
      timezone: a.timezone
    }))
    const remembered = this.readPreference()
    const active = accounts.find((a) => a.id === remembered) ?? accounts[0] ?? null
    return { accounts, activeAccountId: active?.id ?? null }
  }

  setActive(accountId: string): AccountListDto {
    const exists = this.db.repositories.accounts.list().some((a) => a.id === accountId)
    if (!exists) throw new ServiceError('NOT_FOUND', 'Account not found.')
    this.store.write(accountId)
    return this.list()
  }

  private readPreference(): string | null {
    try {
      return this.store.read()
    } catch {
      return null
    }
  }
}
