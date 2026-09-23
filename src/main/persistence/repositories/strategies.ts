import { newId } from '../ids'
import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, intOrNull, str } from '../sql'
import type { LifecycleStatus, Strategy } from '../types'

function toStrategy(row: Row): Strategy {
  return {
    id: str(row['id']),
    name: str(row['name']),
    description: str(row['description']),
    status: str(row['status']) === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    archivedAt: intOrNull(row['archived_at']),
    displayPosition: int(row['display_position']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

// Positions are rewritten in two phases (park above this offset, then land),
// because SQLite checks the (status, display_position) UNIQUE index row by row.
const PARK_OFFSET = 1_000_000

/**
 * Durable Strategy identity/metadata. Versions live in StrategyVersionRepository.
 *
 * `display_position` (migration 006) is list presentation metadata only. It is
 * kept dense (0..n-1) and unique within each lifecycle section, and nothing
 * here touches a version, rule, trade or evaluation when it changes.
 */
export class StrategyRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  /** New strategies are placed at the end of the Active section. */
  create(input: { name: string; description?: string }): Strategy {
    return this.sql.transaction(() => {
      const id = newId()
      const at = BigInt(this.now())
      this.sql.run(
        `INSERT INTO strategies (id, name, description, status, archived_at, display_position, created_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', NULL, ?, ?, ?)`,
        [id, input.name, input.description ?? '', this.nextPosition('ACTIVE'), at, at]
      )
      return this.require(id)
    })
  }

  getById(id: string): Strategy | null {
    const row = this.sql.get('SELECT * FROM strategies WHERE id = ?', [id])
    return row === undefined ? null : toStrategy(row)
  }

  require(id: string): Strategy {
    const strategy = this.getById(id)
    if (strategy === null) throw new Error(`Strategy not found: ${id}`)
    return strategy
  }

  /** Active first, then Archived; each section in its manual display order. */
  list(options: { includeArchived?: boolean } = {}): Strategy[] {
    const where = options.includeArchived === true ? '' : `WHERE status = 'ACTIVE'`
    return this.sql
      .all(
        `SELECT * FROM strategies ${where}
         ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, display_position, created_at, id`
      )
      .map(toStrategy)
  }

  /** Name/description are presentation data: editing them never creates a version. */
  updateMetadata(id: string, patch: { name?: string; description?: string }): Strategy {
    const current = this.require(id)
    this.sql.run('UPDATE strategies SET name = ?, description = ?, updated_at = ? WHERE id = ?', [
      patch.name ?? current.name,
      patch.description ?? current.description,
      BigInt(this.now()),
      id
    ])
    return this.require(id)
  }

  /**
   * Permanently deletes a Strategy that has NEVER been published, together
   * with its Draft content. Safe by definition: nothing can reference a
   * Draft (trades and evaluations only reference published versions). Throws
   * if any published version exists; such strategies are archived, never
   * deleted (docs/STRATEGY_VERSIONING.md §10).
   */
  deleteNeverPublished(id: string): void {
    this.sql.transaction(() => {
      const strategy = this.require(id)
      const published = this.sql.get(
        `SELECT COUNT(*) AS n FROM strategy_versions WHERE strategy_id = ? AND state = 'PUBLISHED'`,
        [id]
      )
      if (published === undefined || int(published['n']) > 0) {
        throw new Error(`Strategy ${id} has published versions and cannot be deleted`)
      }
      this.sql.run('DELETE FROM rules WHERE strategy_version_id IN (SELECT id FROM strategy_versions WHERE strategy_id = ?)', [id])
      this.sql.run('DELETE FROM rule_groups WHERE strategy_version_id IN (SELECT id FROM strategy_versions WHERE strategy_id = ?)', [id])
      this.sql.run('DELETE FROM strategy_versions WHERE strategy_id = ?', [id])
      this.sql.run('DELETE FROM strategies WHERE id = ?', [id])
      this.writeOrder(this.sectionIds(strategy.status))
    })
  }

  /**
   * Archive is reversible and never touches versions, rules, trades or
   * evaluations. The strategy moves to the END of the section it enters
   * (archive → end of Archived, restore → end of Active) and the section it
   * left is compacted, so both stay dense and deterministic.
   */
  setArchived(id: string, archived: boolean): Strategy {
    return this.sql.transaction(() => {
      const current = this.require(id)
      const target: LifecycleStatus = archived ? 'ARCHIVED' : 'ACTIVE'
      if (current.status === target) return current
      const at = BigInt(this.now())
      this.sql.run(
        'UPDATE strategies SET status = ?, archived_at = ?, display_position = ?, updated_at = ? WHERE id = ?',
        [target, archived ? at : null, this.nextPosition(target), at, id]
      )
      this.writeOrder(this.sectionIds(current.status))
      return this.require(id)
    })
  }

  /**
   * Moves one strategy to `toIndex` within its own lifecycle section; the
   * others keep their relative order. Presentation metadata only: `updated_at`
   * is left alone and no other table is written. Returns the section's new
   * order. Throws if `toIndex` is outside the section.
   */
  move(id: string, toIndex: number): Strategy[] {
    return this.sql.transaction(() => {
      const strategy = this.require(id)
      const order = this.sectionIds(strategy.status)
      if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= order.length) {
        throw new Error(`Position ${toIndex} is outside the ${strategy.status} list`)
      }
      const next = order.filter((x) => x !== id)
      next.splice(toIndex, 0, id)
      this.writeOrder(next)
      return next.map((x) => this.require(x))
    })
  }

  // ---- ordering internals --------------------------------------------------

  private sectionIds(status: LifecycleStatus): string[] {
    return this.sql
      .all('SELECT id FROM strategies WHERE status = ? ORDER BY display_position, created_at, id', [status])
      .map((row) => str(row['id']))
  }

  private nextPosition(status: LifecycleStatus): number {
    const row = this.sql.get(
      'SELECT COALESCE(MAX(display_position) + 1, 0) AS next FROM strategies WHERE status = ?',
      [status]
    )
    return row === undefined ? 0 : int(row['next'])
  }

  /** Rewrites one section to positions 0..n-1 in the given order (callers hold a transaction). */
  private writeOrder(ids: readonly string[]): void {
    ids.forEach((x, index) => {
      this.sql.run('UPDATE strategies SET display_position = ? WHERE id = ?', [PARK_OFFSET + index, x])
    })
    ids.forEach((x, index) => {
      this.sql.run('UPDATE strategies SET display_position = ? WHERE id = ?', [index, x])
    })
  }
}
