import { newId } from '../ids'
import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, intOrNull, str } from '../sql'
import type { Strategy } from '../types'

function toStrategy(row: Row): Strategy {
  return {
    id: str(row['id']),
    name: str(row['name']),
    description: str(row['description']),
    status: str(row['status']) === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    archivedAt: intOrNull(row['archived_at']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

/** Durable Strategy identity/metadata. Versions live in StrategyVersionRepository. */
export class StrategyRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  create(input: { name: string; description?: string }): Strategy {
    const id = newId()
    const at = BigInt(this.now())
    this.sql.run(
      `INSERT INTO strategies (id, name, description, status, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, 'ACTIVE', NULL, ?, ?)`,
      [id, input.name, input.description ?? '', at, at]
    )
    return this.require(id)
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

  list(options: { includeArchived?: boolean } = {}): Strategy[] {
    const where = options.includeArchived === true ? '' : `WHERE status = 'ACTIVE'`
    return this.sql
      .all(`SELECT * FROM strategies ${where} ORDER BY created_at, id`)
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

  /** Archive is reversible and never touches versions, rules, trades or evaluations. */
  setArchived(id: string, archived: boolean): Strategy {
    this.require(id)
    const at = BigInt(this.now())
    this.sql.run('UPDATE strategies SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?', [
      archived ? 'ARCHIVED' : 'ACTIVE',
      archived ? at : null,
      at,
      id
    ])
    return this.require(id)
  }
}
