import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Local user preference: which account the trading screens show. It is app
 * preference, not trading data, so it lives in a small JSON file in userData
 * beside the database — never in a trading table and never in a migration.
 */
export interface ActiveAccountStore {
  read(): string | null
  write(accountId: string): void
}

export class FileActiveAccountStore implements ActiveAccountStore {
  constructor(private readonly path: string) {}

  /** Missing, unreadable, or malformed files all read as "no preference". */
  read(): string | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) {
        const value = (parsed as Record<string, unknown>)['activeAccountId']
        if (typeof value === 'string' && value !== '') return value
      }
    } catch {
      // fall through
    }
    return null
  }

  write(accountId: string): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify({ activeAccountId: accountId }), 'utf8')
    renameSync(temp, this.path)
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
