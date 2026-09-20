import { DatabaseSync } from 'node:sqlite'
import { systemClock } from './ids'
import type { Clock } from './ids'
import { MIGRATIONS } from './migrations'
import { runMigrations } from './migrator'
import type { Migration, MigrationResult } from './migrator'
import { AccountRepository } from './repositories/accounts'
import { EvaluationRepository } from './repositories/evaluations'
import { NoteRepository } from './repositories/notes'
import { StrategyRepository } from './repositories/strategies'
import { StrategyVersionRepository } from './repositories/strategyVersions'
import { TradeRepository } from './repositories/trades'
import { Sql, int } from './sql'

export interface Repositories {
  accounts: AccountRepository
  trades: TradeRepository
  strategies: StrategyRepository
  strategyVersions: StrategyVersionRepository
  evaluations: EvaluationRepository
  notes: NoteRepository
}

export interface DatabaseHealth {
  path: string
  foreignKeys: boolean
  journalMode: string
  schemaVersion: number
  migrationsAppliedThisOpen: readonly number[]
}

export interface OpenOptions {
  /** Injectable for tests. */
  clock?: Clock
  /** Injectable for tests of the migration system itself. */
  migrations?: readonly Migration[]
}

/**
 * The persistence facade owned by the Electron main process. It holds the
 * only open connection; everything else gets application-level repositories.
 * The raw connection is never exposed.
 */
export class Database {
  private closed = false

  private constructor(
    private readonly connection: DatabaseSync,
    private readonly sql: Sql,
    readonly repositories: Repositories,
    readonly health: DatabaseHealth
  ) {}

  /**
   * Opens (creating if absent) the database at `path`, enables foreign keys
   * and WAL, and applies pending migrations. Throws on any failure; a
   * partially opened connection is closed before the error propagates.
   * Use ':memory:' for a throwaway database.
   */
  static open(path: string, options: OpenOptions = {}): Database {
    const connection = new DatabaseSync(path)
    try {
      const sql = new Sql(connection)
      sql.exec('PRAGMA foreign_keys = ON')
      sql.exec('PRAGMA busy_timeout = 5000')
      if (path !== ':memory:') {
        sql.exec('PRAGMA journal_mode = WAL')
        sql.exec('PRAGMA synchronous = NORMAL')
      }

      const foreignKeyRow = sql.get('PRAGMA foreign_keys')
      const foreignKeys = foreignKeyRow !== undefined && int(foreignKeyRow['foreign_keys']) === 1
      if (!foreignKeys) throw new Error('SQLite foreign key enforcement could not be enabled')

      const result: MigrationResult = runMigrations(sql, options.migrations ?? MIGRATIONS)
      const journalMode = String(sql.get('PRAGMA journal_mode')?.['journal_mode'] ?? 'unknown')

      const now = options.clock ?? systemClock
      const accounts = new AccountRepository(sql, now)
      const repositories: Repositories = {
        accounts,
        trades: new TradeRepository(sql, now, accounts),
        strategies: new StrategyRepository(sql, now),
        strategyVersions: new StrategyVersionRepository(sql, now),
        evaluations: new EvaluationRepository(sql, now),
        notes: new NoteRepository(sql, now)
      }
      return new Database(connection, sql, repositories, {
        path,
        foreignKeys,
        journalMode,
        schemaVersion: result.currentVersion,
        migrationsAppliedThisOpen: result.applied
      })
    } catch (error) {
      connection.close()
      throw error
    }
  }

  /**
   * Runs `fn` atomically across repositories (BEGIN IMMEDIATE / COMMIT, or a
   * SAVEPOINT when nested). Any throw rolls everything back. This is
   * transaction control only; it does not expose the connection.
   */
  transaction<T>(fn: () => T): T {
    return this.sql.transaction(fn)
  }

  /** Test/diagnostic access to the migration history. */
  listAppliedMigrations(): { version: number; name: string }[] {
    return this.sql
      .all('SELECT version, name FROM schema_migrations ORDER BY version')
      .map((row) => ({ version: Number(row['version']), name: String(row['name']) }))
  }

  /** Idempotent. Checkpoints the WAL and releases the file. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.connection.close()
  }
}
