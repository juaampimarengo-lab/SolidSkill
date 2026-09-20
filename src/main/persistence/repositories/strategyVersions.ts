import { newId } from '../ids'
import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, intOrNull, str, strOrNull } from '../sql'
import type {
  Rule,
  RuleGroup,
  RuleGroupWithRules,
  RuleKind,
  StrategyVersion,
  StrategyVersionDefinition
} from '../types'

export function toStrategyVersion(row: Row): StrategyVersion {
  return {
    id: str(row['id']),
    strategyId: str(row['strategy_id']),
    state: str(row['state']) === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
    versionNumber: intOrNull(row['version_number']),
    baseVersionId: strOrNull(row['base_version_id']),
    publishedAt: intOrNull(row['published_at']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

export function toRuleGroup(row: Row): RuleGroup {
  return {
    id: str(row['id']),
    strategyVersionId: str(row['strategy_version_id']),
    name: str(row['name']),
    description: str(row['description']),
    position: int(row['position'])
  }
}

export function toRule(row: Row): Rule {
  return {
    id: str(row['id']),
    strategyVersionId: str(row['strategy_version_id']),
    ruleGroupId: str(row['rule_group_id']),
    title: str(row['title']),
    description: str(row['description']),
    kind: str(row['kind']) as RuleKind,
    position: int(row['position'])
  }
}

/**
 * Strategy Versions, Rule Groups and Rules.
 *
 * Model: one Draft (state DRAFT) per Strategy at most, many immutable
 * Published versions. Rule content can only be written while its version is
 * a Draft; the repository checks this explicitly and the schema enforces it
 * again with triggers. Publishing flips the Draft row to PUBLISHED in place.
 */
export class StrategyVersionRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  // ---- reads -------------------------------------------------------------

  getVersion(id: string): StrategyVersion | null {
    const row = this.sql.get('SELECT * FROM strategy_versions WHERE id = ?', [id])
    return row === undefined ? null : toStrategyVersion(row)
  }

  requireVersion(id: string): StrategyVersion {
    const version = this.getVersion(id)
    if (version === null) throw new Error(`Strategy version not found: ${id}`)
    return version
  }

  getDraft(strategyId: string): StrategyVersion | null {
    const row = this.sql.get(
      `SELECT * FROM strategy_versions WHERE strategy_id = ? AND state = 'DRAFT'`,
      [strategyId]
    )
    return row === undefined ? null : toStrategyVersion(row)
  }

  getLatestPublished(strategyId: string): StrategyVersion | null {
    const row = this.sql.get(
      `SELECT * FROM strategy_versions WHERE strategy_id = ? AND state = 'PUBLISHED'
       ORDER BY version_number DESC LIMIT 1`,
      [strategyId]
    )
    return row === undefined ? null : toStrategyVersion(row)
  }

  /** Published versions, oldest first (v1, v2, ...). Drafts are never listed. */
  listPublished(strategyId: string): StrategyVersion[] {
    return this.sql
      .all(
        `SELECT * FROM strategy_versions WHERE strategy_id = ? AND state = 'PUBLISHED'
         ORDER BY version_number`,
        [strategyId]
      )
      .map(toStrategyVersion)
  }

  /** The full ordered Group/Rule structure of exactly this version. */
  getDefinition(versionId: string): StrategyVersionDefinition {
    const version = this.requireVersion(versionId)
    const groups: RuleGroupWithRules[] = this.sql
      .all('SELECT * FROM rule_groups WHERE strategy_version_id = ? ORDER BY position, id', [
        versionId
      ])
      .map((row) => ({ ...toRuleGroup(row), rules: [] }))
    const byId = new Map(groups.map((group) => [group.id, group]))
    const rules = this.sql
      .all('SELECT * FROM rules WHERE strategy_version_id = ? ORDER BY position, id', [versionId])
      .map(toRule)
    for (const rule of rules) byId.get(rule.ruleGroupId)?.rules.push(rule)
    return { version, groups }
  }

  listRules(versionId: string): Rule[] {
    return this.sql
      .all(
        `SELECT r.* FROM rules r JOIN rule_groups g ON g.id = r.rule_group_id
         WHERE r.strategy_version_id = ? ORDER BY g.position, g.id, r.position, r.id`,
        [versionId]
      )
      .map(toRule)
  }

  // ---- draft lifecycle ---------------------------------------------------

  /**
   * Starts the Strategy's Draft: a copy (with fresh ids) of the latest
   * published version's structure, or empty if none has been published.
   * Throws if a Draft already exists.
   */
  createDraft(strategyId: string): StrategyVersion {
    return this.sql.transaction(() => {
      if (this.getDraft(strategyId) !== null) {
        throw new Error(`Strategy ${strategyId} already has a draft`)
      }
      const base = this.getLatestPublished(strategyId)
      const draftId = newId()
      const at = BigInt(this.now())
      this.sql.run(
        `INSERT INTO strategy_versions (id, strategy_id, state, version_number, base_version_id,
                                        published_at, created_at, updated_at)
         VALUES (?, ?, 'DRAFT', NULL, ?, NULL, ?, ?)`,
        [draftId, strategyId, base?.id ?? null, at, at]
      )
      if (base !== null) {
        const groupIdMap = new Map<string, string>()
        for (const group of this.getDefinition(base.id).groups) {
          const groupId = newId()
          groupIdMap.set(group.id, groupId)
          this.sql.run(
            `INSERT INTO rule_groups (id, strategy_version_id, name, description, position,
                                      created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [groupId, draftId, group.name, group.description, group.position, at, at]
          )
          for (const rule of group.rules) {
            this.sql.run(
              `INSERT INTO rules (id, strategy_version_id, rule_group_id, title, description, kind,
                                  position, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [newId(), draftId, groupId, rule.title, rule.description, rule.kind, rule.position, at, at]
            )
          }
        }
      }
      return this.requireVersion(draftId)
    })
  }

  /** Deletes the Draft and its content. Safe: a Draft has no history. */
  discardDraft(strategyId: string): void {
    this.sql.transaction(() => {
      const draft = this.getDraft(strategyId)
      if (draft === null) throw new Error(`Strategy ${strategyId} has no draft`)
      this.sql.run('DELETE FROM rules WHERE strategy_version_id = ?', [draft.id])
      this.sql.run('DELETE FROM rule_groups WHERE strategy_version_id = ?', [draft.id])
      this.sql.run('DELETE FROM strategy_versions WHERE id = ?', [draft.id])
    })
  }

  /** Turns the Draft into the next sequential immutable Published version. */
  publishDraft(strategyId: string): StrategyVersion {
    return this.sql.transaction(() => {
      const draft = this.getDraft(strategyId)
      if (draft === null) throw new Error(`Strategy ${strategyId} has no draft to publish`)
      const latest = this.getLatestPublished(strategyId)
      const at = BigInt(this.now())
      this.sql.run(
        `UPDATE strategy_versions
         SET state = 'PUBLISHED', version_number = ?, published_at = ?, updated_at = ?
         WHERE id = ?`,
        [(latest?.versionNumber ?? 0) + 1, at, at, draft.id]
      )
      return this.requireVersion(draft.id)
    })
  }

  // ---- draft editing (rejected for published versions) -------------------

  private requireDraftVersion(versionId: string): StrategyVersion {
    const version = this.requireVersion(versionId)
    if (version.state !== 'DRAFT') {
      throw new Error(`Strategy version ${versionId} is published and immutable`)
    }
    return version
  }

  private requireGroup(groupId: string): RuleGroup {
    const row = this.sql.get('SELECT * FROM rule_groups WHERE id = ?', [groupId])
    if (row === undefined) throw new Error(`Rule group not found: ${groupId}`)
    return toRuleGroup(row)
  }

  private requireRule(ruleId: string): Rule {
    const row = this.sql.get('SELECT * FROM rules WHERE id = ?', [ruleId])
    if (row === undefined) throw new Error(`Rule not found: ${ruleId}`)
    return toRule(row)
  }

  private nextPosition(table: 'rule_groups' | 'rules', column: string, value: string): number {
    const row = this.sql.get(
      `SELECT COALESCE(MAX(position) + 1, 0) AS next FROM ${table} WHERE ${column} = ?`,
      [value]
    )
    return row === undefined ? 0 : int(row['next'])
  }

  addGroup(draftVersionId: string, input: { name: string; description?: string }): RuleGroup {
    this.requireDraftVersion(draftVersionId)
    const id = newId()
    const at = BigInt(this.now())
    this.sql.run(
      `INSERT INTO rule_groups (id, strategy_version_id, name, description, position,
                                created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        draftVersionId,
        input.name,
        input.description ?? '',
        this.nextPosition('rule_groups', 'strategy_version_id', draftVersionId),
        at,
        at
      ]
    )
    return this.requireGroup(id)
  }

  updateGroup(
    groupId: string,
    patch: { name?: string; description?: string; position?: number }
  ): RuleGroup {
    const group = this.requireGroup(groupId)
    this.requireDraftVersion(group.strategyVersionId)
    this.sql.run(
      'UPDATE rule_groups SET name = ?, description = ?, position = ?, updated_at = ? WHERE id = ?',
      [
        patch.name ?? group.name,
        patch.description ?? group.description,
        patch.position ?? group.position,
        BigInt(this.now()),
        groupId
      ]
    )
    return this.requireGroup(groupId)
  }

  removeGroup(groupId: string): void {
    const group = this.requireGroup(groupId)
    this.requireDraftVersion(group.strategyVersionId)
    this.sql.transaction(() => {
      this.sql.run('DELETE FROM rules WHERE rule_group_id = ?', [groupId])
      this.sql.run('DELETE FROM rule_groups WHERE id = ?', [groupId])
    })
  }

  addRule(
    groupId: string,
    input: { title: string; description?: string; kind: RuleKind }
  ): Rule {
    const group = this.requireGroup(groupId)
    this.requireDraftVersion(group.strategyVersionId)
    const id = newId()
    const at = BigInt(this.now())
    this.sql.run(
      `INSERT INTO rules (id, strategy_version_id, rule_group_id, title, description, kind,
                          position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        group.strategyVersionId,
        groupId,
        input.title,
        input.description ?? '',
        input.kind,
        this.nextPosition('rules', 'rule_group_id', groupId),
        at,
        at
      ]
    )
    return this.requireRule(id)
  }

  updateRule(
    ruleId: string,
    patch: { title?: string; description?: string; kind?: RuleKind; position?: number }
  ): Rule {
    const rule = this.requireRule(ruleId)
    this.requireDraftVersion(rule.strategyVersionId)
    this.sql.run(
      `UPDATE rules SET title = ?, description = ?, kind = ?, position = ?, updated_at = ?
       WHERE id = ?`,
      [
        patch.title ?? rule.title,
        patch.description ?? rule.description,
        patch.kind ?? rule.kind,
        patch.position ?? rule.position,
        BigInt(this.now()),
        ruleId
      ]
    )
    return this.requireRule(ruleId)
  }

  removeRule(ruleId: string): void {
    const rule = this.requireRule(ruleId)
    this.requireDraftVersion(rule.strategyVersionId)
    this.sql.run('DELETE FROM rules WHERE id = ?', [ruleId])
  }
}
