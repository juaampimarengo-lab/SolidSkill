import { newId } from '../ids'
import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, intOrNull, str, strOrNull } from '../sql'
import type { Account, SourcePlatform } from '../types'

export interface NewAccount {
  displayName: string
  sourcePlatform: SourcePlatform
  sourceAccountId?: string | null
  currency: string
  timezone?: string | null
}

function toAccount(row: Row): Account {
  return {
    id: str(row['id']),
    displayName: str(row['display_name']),
    sourcePlatform: str(row['source_platform']),
    sourceAccountId: strOrNull(row['source_account_id']),
    currency: str(row['currency']),
    timezone: strOrNull(row['timezone']),
    status: str(row['status']) === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    archivedAt: intOrNull(row['archived_at']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

export class AccountRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  create(input: NewAccount): Account {
    const id = newId()
    const at = BigInt(this.now())
    this.sql.run(
      `INSERT INTO accounts (id, display_name, source_platform, source_account_id, currency, timezone,
                             status, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, ?)`,
      [
        id,
        input.displayName,
        input.sourcePlatform,
        input.sourceAccountId ?? null,
        input.currency,
        input.timezone ?? null,
        at,
        at
      ]
    )
    return this.require(id)
  }

  getById(id: string): Account | null {
    const row = this.sql.get('SELECT * FROM accounts WHERE id = ?', [id])
    return row === undefined ? null : toAccount(row)
  }

  require(id: string): Account {
    const account = this.getById(id)
    if (account === null) throw new Error(`Account not found: ${id}`)
    return account
  }

  /** Reconciliation lookup by the platform's own account identifier. */
  findBySource(sourcePlatform: SourcePlatform, sourceAccountId: string): Account | null {
    const row = this.sql.get(
      'SELECT * FROM accounts WHERE source_platform = ? AND source_account_id = ?',
      [sourcePlatform, sourceAccountId]
    )
    return row === undefined ? null : toAccount(row)
  }

  list(options: { includeArchived?: boolean } = {}): Account[] {
    const where = options.includeArchived === true ? '' : `WHERE status = 'ACTIVE'`
    return this.sql
      .all(`SELECT * FROM accounts ${where} ORDER BY created_at, id`)
      .map(toAccount)
  }

  updateMetadata(id: string, patch: { displayName?: string; timezone?: string | null }): Account {
    const current = this.require(id)
    this.sql.run('UPDATE accounts SET display_name = ?, timezone = ?, updated_at = ? WHERE id = ?', [
      patch.displayName ?? current.displayName,
      patch.timezone === undefined ? current.timezone : patch.timezone,
      BigInt(this.now()),
      id
    ])
    return this.require(id)
  }

  /** Archive is reversible and never deletes or hides trade history. */
  setArchived(id: string, archived: boolean): Account {
    this.require(id)
    const at = BigInt(this.now())
    this.sql.run('UPDATE accounts SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?', [
      archived ? 'ARCHIVED' : 'ACTIVE',
      archived ? at : null,
      at,
      id
    ])
    return this.require(id)
  }
}
