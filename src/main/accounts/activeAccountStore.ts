import { readPreferencesFile, writePreferencesFile } from '../preferences/preferencesFile'

/**
 * Local user preference: which account the trading screens show. It is app
 * preference, not trading data, so it lives in a small JSON file in userData
 * beside the database — never in a trading table and never in a migration.
 * That file is shared with other preferences (e.g. language), so reads/writes
 * go through preferencesFile's merge-safe helpers rather than touching the
 * file directly.
 */
export interface ActiveAccountStore {
  read(): string | null
  write(accountId: string): void
}

export class FileActiveAccountStore implements ActiveAccountStore {
  constructor(private readonly path: string) {}

  /** Missing, unreadable, or malformed files all read as "no preference". */
  read(): string | null {
    const value = readPreferencesFile(this.path).activeAccountId
    return typeof value === 'string' && value !== '' ? value : null
  }

  write(accountId: string): void {
    writePreferencesFile(this.path, { activeAccountId: accountId })
  }
}

export class MemoryActiveAccountStore implements ActiveAccountStore {
  constructor(private value: string | null = null) {}
  read(): string | null {
    return this.value
  }
  write(accountId: string): void {
    this.value = accountId
  }
}
