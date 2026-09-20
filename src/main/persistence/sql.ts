import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite'

/** A row as read by this layer: every SQLite INTEGER arrives as bigint. */
export type Row = Record<string, SQLOutputValue>
export type Param = SQLInputValue

/**
 * Thin wrapper over node:sqlite's DatabaseSync. It exists so repositories
 * (1) read INTEGER columns as bigint — required for exact fixed-point
 * values — and (2) share one nestable transaction helper. Repositories never
 * receive the raw DatabaseSync, and nothing outside src/main/persistence
 * ever receives this wrapper.
 */
export class Sql {
  private depth = 0

  constructor(private readonly db: DatabaseSync) {}

  run(sql: string, params: readonly Param[] = []): void {
    this.db.prepare(sql).run(...params)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  get(sql: string, params: readonly Param[] = []): Row | undefined {
    const statement = this.db.prepare(sql)
    statement.setReadBigInts(true)
    return statement.get(...params) as Row | undefined
  }

  all(sql: string, params: readonly Param[] = []): Row[] {
    const statement = this.db.prepare(sql)
    statement.setReadBigInts(true)
    return statement.all(...params) as Row[]
  }

  /**
   * Runs `fn` atomically. The outermost call is BEGIN IMMEDIATE / COMMIT;
   * nested calls become SAVEPOINTs, so a repository method that opens its
   * own transaction composes safely inside a larger one. Any throw rolls
   * back and rethrows.
   */
  transaction<T>(fn: () => T): T {
    const outermost = this.depth === 0
    const savepoint = `sp_${this.depth}`
    this.db.exec(outermost ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
    this.depth += 1
    try {
      const result = fn()
      this.depth -= 1
      this.db.exec(outermost ? 'COMMIT' : `RELEASE ${savepoint}`)
      return result
    } catch (error) {
      this.depth -= 1
      this.db.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
      throw error
    }
  }
}

export function str(value: SQLOutputValue): string {
  if (typeof value !== 'string') throw new TypeError(`Expected TEXT, got ${typeof value}`)
  return value
}

export function strOrNull(value: SQLOutputValue): string | null {
  return value === null ? null : str(value)
}

export function big(value: SQLOutputValue): bigint {
  if (typeof value !== 'bigint') throw new TypeError(`Expected INTEGER, got ${typeof value}`)
  return value
}

export function bigOrNull(value: SQLOutputValue): bigint | null {
  return value === null ? null : big(value)
}

/** For ordinary counters/timestamps/positions that fit a JS number safely. */
export function int(value: SQLOutputValue): number {
  return Number(big(value))
}

export function intOrNull(value: SQLOutputValue): number | null {
  return value === null ? null : int(value)
}
