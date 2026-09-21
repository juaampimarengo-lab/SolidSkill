import type { Database, Rule, RuleKind, Strategy, StrategyVersionDefinition } from '../persistence'
import type {
  DraftEdit,
  RuleDto,
  RuleGroupDto,
  RuleKindDto,
  StrategyDto,
  StrategyDraftDto,
  StrategyVersionDto
} from '../../shared/ipc/strategies'
import { ServiceError } from '../serviceError'
import { draftPublishBlocker, summarizeChanges } from '../../shared/strategyRules'

export { ServiceError }

const KIND_TO_DB: Record<RuleKindDto, RuleKind> = {
  Required: 'REQUIRED',
  Optional: 'OPTIONAL',
  Conditional: 'CONDITIONAL'
}
const KIND_FROM_DB: Record<RuleKind, RuleKindDto> = {
  REQUIRED: 'Required',
  OPTIONAL: 'Optional',
  CONDITIONAL: 'Conditional'
}

function toRuleDto(rule: Rule): RuleDto {
  return { id: rule.id, name: rule.title, description: rule.description, kind: KIND_FROM_DB[rule.kind] }
}

function toGroupDtos(definition: StrategyVersionDefinition): RuleGroupDto[] {
  return definition.groups.map((group) => ({
    id: group.id,
    name: group.name,
    rules: group.rules.map(toRuleDto)
  }))
}

/**
 * Strategy application service: the only place Strategy business operations
 * are composed from repositories. It knows nothing about Electron or IPC and
 * is tested directly. Every mutating operation is one transaction and returns
 * the resulting Strategy aggregate, so the renderer reconciles with what was
 * actually persisted.
 */
export class StrategyService {
  constructor(private readonly db: Database) {}

  // ---- reads -------------------------------------------------------------

  list(): StrategyDto[] {
    return this.db.repositories.strategies.list({ includeArchived: true }).map((s) => this.toDto(s))
  }

  // ---- strategy lifecycle -------------------------------------------------

  create(input: { name: string; description: string }): StrategyDto {
    return this.db.transaction(() => {
      this.assertNameAvailable(input.name, null)
      const { strategies, strategyVersions } = this.db.repositories
      const strategy = strategies.create({ name: input.name, description: input.description })
      strategyVersions.createDraft(strategy.id)
      return this.toDto(strategy)
    })
  }

  updateDetails(input: { strategyId: string; name: string; description: string }): StrategyDto {
    return this.db.transaction(() => {
      const strategy = this.requireActive(input.strategyId)
      this.assertNameAvailable(input.name, strategy.id)
      return this.toDto(
        this.db.repositories.strategies.updateMetadata(strategy.id, {
          name: input.name,
          description: input.description
        })
      )
    })
  }

  archive(strategyId: string): StrategyDto {
    return this.db.transaction(() => {
      const { strategies, strategyVersions } = this.db.repositories
      const strategy = this.require(strategyId)
      if (strategy.status === 'ARCHIVED') return this.toDto(strategy)
      if (strategyVersions.getLatestPublished(strategy.id) === null) {
        throw new ServiceError('RULE_VIOLATION', 'A never-published strategy cannot be archived; delete it instead')
      }
      if (strategyVersions.getDraft(strategy.id) !== null) {
        throw new ServiceError('RULE_VIOLATION', 'Publish or discard the draft before archiving')
      }
      return this.toDto(strategies.setArchived(strategy.id, true))
    })
  }

  restore(strategyId: string): StrategyDto {
    return this.db.transaction(() => {
      const strategy = this.require(strategyId)
      if (strategy.status === 'ACTIVE') return this.toDto(strategy)
      return this.toDto(this.db.repositories.strategies.setArchived(strategy.id, false))
    })
  }

  deleteUnpublished(strategyId: string): void {
    this.db.transaction(() => {
      const strategy = this.require(strategyId)
      if (this.db.repositories.strategyVersions.getLatestPublished(strategy.id) !== null) {
        throw new ServiceError('RULE_VIOLATION', 'A strategy with published versions cannot be deleted; archive it')
      }
      this.db.repositories.strategies.deleteNeverPublished(strategy.id)
    })
  }

  // ---- draft lifecycle ----------------------------------------------------

  beginDraft(strategyId: string): StrategyDto {
    return this.db.transaction(() => {
      const strategy = this.requireActive(strategyId)
      if (this.db.repositories.strategyVersions.getDraft(strategy.id) !== null) {
        throw new ServiceError('CONFLICT', 'This strategy already has a draft')
      }
      this.db.repositories.strategyVersions.createDraft(strategy.id)
      return this.toDto(strategy)
    })
  }

  discardDraft(strategyId: string): StrategyDto {
    return this.db.transaction(() => {
      const { strategyVersions } = this.db.repositories
      const strategy = this.require(strategyId)
      if (strategyVersions.getDraft(strategy.id) === null) {
        throw new ServiceError('NOT_FOUND', 'This strategy has no draft')
      }
      if (strategyVersions.getLatestPublished(strategy.id) === null) {
        throw new ServiceError('RULE_VIOLATION', 'A never-published strategy has no version to return to; delete it instead')
      }
      strategyVersions.discardDraft(strategy.id)
      return this.toDto(strategy)
    })
  }

  editDraft(strategyId: string, edit: DraftEdit): StrategyDto {
    return this.db.transaction(() => {
      const { strategyVersions } = this.db.repositories
      const strategy = this.requireActive(strategyId)
      const draft = strategyVersions.getDraft(strategy.id)
      if (draft === null) throw new ServiceError('NOT_FOUND', 'This strategy has no draft')
      // Group/rule ids are only honoured if they belong to THIS strategy's draft.
      const definition = strategyVersions.getDefinition(draft.id)
      const group = (id: string) => {
        const found = definition.groups.find((g) => g.id === id)
        if (!found) throw new ServiceError('NOT_FOUND', 'Rule group not found in this draft')
        return found
      }
      const ruleLocation = (id: string) => {
        for (const g of definition.groups) {
          const r = g.rules.find((x) => x.id === id)
          if (r) return { group: g, rule: r }
        }
        throw new ServiceError('NOT_FOUND', 'Rule not found in this draft')
      }

      switch (edit.type) {
        case 'addGroup':
          strategyVersions.addGroup(draft.id, { name: edit.name })
          break
        case 'renameGroup':
          strategyVersions.updateGroup(group(edit.groupId).id, { name: edit.name })
          break
        case 'deleteGroup':
          strategyVersions.removeGroup(group(edit.groupId).id)
          break
        case 'moveGroup': {
          const order = definition.groups.map((g) => g.id)
          const moved = swap(order, order.indexOf(group(edit.groupId).id), edit.delta)
          moved.forEach((id, position) => {
            if (definition.groups.find((g) => g.id === id)?.position !== position) {
              strategyVersions.updateGroup(id, { position })
            }
          })
          break
        }
        case 'addRule':
          strategyVersions.addRule(group(edit.groupId).id, {
            title: edit.name,
            description: edit.description,
            kind: KIND_TO_DB[edit.kind]
          })
          break
        case 'updateRule':
          strategyVersions.updateRule(ruleLocation(edit.ruleId).rule.id, {
            title: edit.name,
            description: edit.description,
            kind: KIND_TO_DB[edit.kind]
          })
          break
        case 'deleteRule':
          strategyVersions.removeRule(ruleLocation(edit.ruleId).rule.id)
          break
        case 'moveRule': {
          const { group: owner, rule } = ruleLocation(edit.ruleId)
          const order = owner.rules.map((r) => r.id)
          const moved = swap(order, order.indexOf(rule.id), edit.delta)
          moved.forEach((id, position) => {
            if (owner.rules.find((r) => r.id === id)?.position !== position) {
              strategyVersions.updateRule(id, { position })
            }
          })
          break
        }
      }
      return this.toDto(strategy)
    })
  }

  /**
   * Validates the Draft (same shared rule the UI uses), then flips it to the
   * next sequential published version. One transaction: a failure at any
   * point leaves the Draft exactly as it was and no version behind.
   */
  publishDraft(strategyId: string): StrategyDto {
    return this.db.transaction(() => {
      const { strategyVersions } = this.db.repositories
      const strategy = this.requireActive(strategyId)
      const draft = strategyVersions.getDraft(strategy.id)
      if (draft === null) throw new ServiceError('NOT_FOUND', 'This strategy has no draft')
      const base = draft.baseVersionId === null ? null : strategyVersions.getDefinition(draft.baseVersionId)
      const blocker = draftPublishBlocker(
        strategyVersions.getDefinition(draft.id).groups.map(toShape),
        base?.groups.map(toShape) ?? null,
        base?.version.versionNumber ?? null
      )
      if (blocker !== null) throw new ServiceError('RULE_VIOLATION', blocker)
      strategyVersions.publishDraft(strategy.id)
      return this.toDto(strategy)
    })
  }

  // ---- helpers -------------------------------------------------------------

  private require(strategyId: string): Strategy {
    const strategy = this.db.repositories.strategies.getById(strategyId)
    if (strategy === null) throw new ServiceError('NOT_FOUND', 'Strategy not found')
    return strategy
  }

  private requireActive(strategyId: string): Strategy {
    const strategy = this.require(strategyId)
    if (strategy.status === 'ARCHIVED') {
      throw new ServiceError('RULE_VIOLATION', 'This strategy is archived and read-only; restore it first')
    }
    return strategy
  }

  private assertNameAvailable(name: string, exceptId: string | null): void {
    const wanted = name.trim().toLowerCase()
    const clash = this.db.repositories.strategies
      .list({ includeArchived: true })
      .some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === wanted)
    if (clash) throw new ServiceError('CONFLICT', 'A strategy with this name already exists')
  }

  /** Builds the aggregate from persisted rows; published versions are read, never recomputed. */
  private toDto(strategy: Strategy): StrategyDto {
    const { strategies, strategyVersions } = this.db.repositories
    const fresh = strategies.require(strategy.id)
    const published = strategyVersions.listPublished(fresh.id)
    const definitions = published.map((v) => strategyVersions.getDefinition(v.id))

    const versions: StrategyVersionDto[] = definitions.map((definition, index) => ({
      id: definition.version.id,
      number: definition.version.versionNumber ?? 0,
      publishedAt: definition.version.publishedAt ?? 0,
      groups: toGroupDtos(definition),
      changes: summarizeChanges(
        index === 0 ? null : (definitions[index - 1]?.groups.map(toShape) ?? null),
        definition.groups.map(toShape)
      )
    }))

    const draftRow = strategyVersions.getDraft(fresh.id)
    let draft: StrategyDraftDto | null = null
    if (draftRow !== null) {
      const base = draftRow.baseVersionId === null ? null : strategyVersions.getVersion(draftRow.baseVersionId)
      draft = {
        id: draftRow.id,
        basedOn: base?.versionNumber ?? null,
        groups: toGroupDtos(strategyVersions.getDefinition(draftRow.id))
      }
    }

    return {
      id: fresh.id,
      name: fresh.name,
      description: fresh.description,
      status: fresh.status === 'ARCHIVED' ? 'Archived' : 'Active',
      versions,
      draft
    }
  }
}

function toShape(group: StrategyVersionDefinition['groups'][number]): {
  name: string
  rules: { name: string; kind: string; description: string }[]
} {
  return {
    name: group.name,
    rules: group.rules.map((r) => ({ name: r.title, kind: r.kind, description: r.description }))
  }
}

function swap(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta
  if (index < 0 || target < 0 || target >= ids.length) return ids
  const next = ids.slice()
  const held = next[index] as string
  next[index] = next[target] as string
  next[target] = held
  return next
}
