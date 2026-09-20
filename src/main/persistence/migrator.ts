import { createHash } from 'node:crypto'
import type { Sql } from './sql'
import { big, int, str } from './sql'

export interface Migration {
  /** Sequential, starting at 1, no gaps. */
  readonly version: number
  /** Short snake_case label; informational, recorded in history. */
  readonly name: string
  readonly sql: string
}

export interface MigrationResult {
  readonly applied: readonly number[]
  readonly currentVersion: number
}

const HISTORY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY CHECK (version >= 1),
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT`

function checksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex')
}

function assertWellFormed(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migration registry must be sequential from 1 with no gaps: ` +
          `expected version ${index + 1} at position ${index}, found ${migration.version} (${migration.name})`
      )
    }
  })
}

/**
 * Applies pending migrations in version order, each in its own transaction
 * together with its history row, so a migration is recorded if and only if
 * it fully applied. Already-applied migrations are never re-run.
 *
 * Refuses to proceed (throws) if the history disagrees with the code:
 *  - the database has a migration this build does not know (newer database);
 *  - an applied migration's checksum no longer matches (edited migration).
 */
export function runMigrations(sql: Sql, migrations: readonly Migration[]): MigrationResult {
  assertWellFormed(migrations)
  sql.exec(HISTORY_TABLE_SQL)

  const history = sql.all('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
  const known = new Map(migrations.map((migration) => [migration.version, migration]))

  for (const row of history) {
    const version = int(row['version'])
    const migration = known.get(version)
    if (migration === undefined) {
      throw new Error(
        `Database has migration ${version} (${str(row['name'])}) which this version of ` +
          `Solid Skill does not know. The database was created by a newer version; refusing to open it.`
      )
    }
    if (str(row['checksum']) !== checksum(migration)) {
      throw new Error(
        `Applied migration ${version} (${migration.name}) has been modified since it was applied. ` +
          `Shipped migrations are immutable; add a new migration instead.`
      )
    }
  }

  const appliedVersions = new Set(history.map((row) => int(row['version'])))
  const applied: number[] = []

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    sql.transaction(() => {
      sql.exec(migration.sql)
      sql.run(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        [migration.version, migration.name, checksum(migration), BigInt(Date.now())]
      )
    })
    applied.push(migration.version)
  }

  const latest = sql.get('SELECT MAX(version) AS v FROM schema_migrations')
  return { applied, currentVersion: latest === undefined ? 0 : Number(big(latest['v'])) }
}
