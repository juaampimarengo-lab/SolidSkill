// Pure, immutable session-local edit operations for the Strategy Builder
// workspace. Nothing here touches a published version: every draft
// operation reads/writes `strategy.draft` only, and `startDraft` deep-
// clones the published groups so the draft shares no objects with them.
// Publishing appends a NEW frozen version; existing versions are never
// replaced. UI-state only — no persistence, no Strategy Engine.

import type { RuleDef, RuleGroupDef, RuleKind, Strategy, StrategyDraft, StrategyVersion } from '@renderer/types/strategy'

let idCounter = 0
export function newId(prefix: string): string {
  idCounter += 1
  return `${prefix}-s${idCounter}`
}

function cloneGroups(groups: readonly RuleGroupDef[]): RuleGroupDef[] {
  return groups.map((g) => ({ ...g, rules: g.rules.map((r) => ({ ...r })) }))
}

export function currentVersion(strategy: Strategy): StrategyVersion | null {
  return strategy.versions[strategy.versions.length - 1] ?? null
}

function withDraft(strategy: Strategy, fn: (draft: StrategyDraft) => StrategyDraft): Strategy {
  if (!strategy.draft) return strategy
  return { ...strategy, draft: fn(strategy.draft) }
}

export function startDraft(strategy: Strategy): Strategy {
  if (strategy.draft || strategy.status === 'Archived') return strategy
  const base = currentVersion(strategy)
  return {
    ...strategy,
    draft: {
      basedOn: base?.number ?? null,
      groups: base ? cloneGroups(base.groups) : []
    }
  }
}

// Only a strategy that has been published can discard its draft — a
// never-published strategy's only removal path is delete.
export function discardDraft(strategy: Strategy): Strategy {
  return strategy.versions.length === 0 ? strategy : { ...strategy, draft: null }
}

// Strategy-level metadata. Saved directly: no Draft, no Version, and never
// touches the logic Draft or any published version.
export function updateDetails(strategy: Strategy, name: string, description: string): Strategy {
  return { ...strategy, name, description }
}

export function addGroup(strategy: Strategy, name: string): Strategy {
  return withDraft(strategy, (d) => ({
    ...d,
    groups: [...d.groups, { id: newId('group'), name, rules: [] }]
  }))
}

export function renameGroup(strategy: Strategy, groupId: string, name: string): Strategy {
  return withDraft(strategy, (d) => ({
    ...d,
    groups: d.groups.map((g) => (g.id === groupId ? { ...g, name } : g))
  }))
}

export function deleteGroup(strategy: Strategy, groupId: string): Strategy {
  return withDraft(strategy, (d) => ({ ...d, groups: d.groups.filter((g) => g.id !== groupId) }))
}

function move<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = items.slice()
  const held = next[index]
  next[index] = next[target]
  next[target] = held
  return next
}

export function moveGroup(strategy: Strategy, groupId: string, delta: -1 | 1): Strategy {
  return withDraft(strategy, (d) => ({
    ...d,
    groups: move(
      d.groups,
      d.groups.findIndex((g) => g.id === groupId),
      delta
    )
  }))
}

export interface RuleInput {
  name: string
  kind: RuleKind
  description: string
}

export function addRule(strategy: Strategy, groupId: string, input: RuleInput): Strategy {
  return withDraft(strategy, (d) => ({
    ...d,
    groups: d.groups.map((g) =>
      g.id === groupId ? { ...g, rules: [...g.rules, { id: newId('rule'), ...input }] } : g
    )
  }))
}

export function updateRule(strategy: Strategy, groupId: string, ruleId: string, input: RuleInput): Strategy {
  return withDraft(strategy, (d) => ({
    ...d,
    groups: d.groups.map((g) =>
      g.id === groupId ? { ...g, rules: g.rules.map((r) => (r.id === ruleId ? { ...r, ...input } : r)) } : g
    )
  }))
}

export function deleteRule(strategy: Strategy, groupId: string, ruleId: string): Strategy {
  return withDraft(strategy, (d) => ({
    ...d,
    groups: d.groups.map((g) => (g.id === groupId ? { ...g, rules: g.rules.filter((r) => r.id !== ruleId) } : g))
  }))
}

export function moveRule(strategy: Strategy, groupId: string, ruleId: string, delta: -1 | 1): Strategy {
  return withDraft(strategy, (d) => ({
    ...d,
    groups: d.groups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            rules: move(
              g.rules,
              g.rules.findIndex((r) => r.id === ruleId),
              delta
            )
          }
        : g
    )
  }))
}

// ------------------------------------------------------------- publishing

export function ruleCount(groups: readonly RuleGroupDef[]): number {
  return groups.reduce((n, g) => n + g.rules.length, 0)
}

export function draftHasChanges(strategy: Strategy): boolean {
  const draft = strategy.draft
  if (!draft) return false
  const base = currentVersion(strategy)
  if (!base) return true
  return JSON.stringify(draft.groups) !== JSON.stringify(base.groups)
}

// Reason the draft cannot be published yet, or null when it can. Only rule
// logic versions: name/description are metadata (docs/STRATEGY_VERSIONING.md
// §7) and live outside the Draft.
export function publishBlocker(strategy: Strategy): string | null {
  const draft = strategy.draft
  if (!draft) return 'No draft'
  if (ruleCount(draft.groups) === 0) return 'Add at least one rule before publishing'
  if (draft.groups.some((g) => g.name.trim() === '')) return 'Every group needs a name'
  if (draft.groups.some((g) => g.rules.length === 0)) return 'Remove or fill empty groups before publishing'
  if (!draftHasChanges(strategy)) return `No rule changes from v${draft.basedOn}`
  return null
}

// A deliberately tiny rule-level summary (by id) — not a structural diff.
function summarizeChanges(before: readonly RuleGroupDef[] | null, after: readonly RuleGroupDef[]): string[] {
  if (!before) return ['Initial version']
  const flat = (groups: readonly RuleGroupDef[]): Map<string, RuleDef> =>
    new Map(groups.flatMap((g) => g.rules.map((r): [string, RuleDef] => [r.id, r])))
  const prev = flat(before)
  const next = flat(after)
  const lines: string[] = []
  next.forEach((r, id) => {
    const old = prev.get(id)
    if (!old) lines.push(`+ ${r.name}`)
    else if (old.name !== r.name) lines.push(`${old.name} renamed to ${r.name}`)
    else if (old.description !== r.description || old.kind !== r.kind) lines.push(`${r.name} updated`)
  })
  prev.forEach((r, id) => {
    if (!next.has(id)) lines.push(`− ${r.name}`)
  })
  if (lines.length === 0) lines.push('Grouping or ordering changed')
  return lines
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  }
  return value
}

export function publishDraft(strategy: Strategy, publishedOn: string): Strategy {
  const draft = strategy.draft
  if (!draft || publishBlocker(strategy) !== null) return strategy
  const base = currentVersion(strategy)
  const created: StrategyVersion = deepFreeze({
    number: (base?.number ?? 0) + 1,
    publishedOn,
    groups: cloneGroups(draft.groups),
    changes: summarizeChanges(base?.groups ?? null, draft.groups)
  })
  return { ...strategy, versions: [...strategy.versions, created], draft: null }
}

// ---------------------------------------------------------------- creation

export function createStrategy(name: string, description: string): Strategy {
  return {
    id: newId('strategy'),
    name,
    description,
    status: 'Active',
    versions: [],
    draft: { basedOn: null, groups: [] }
  }
}

// Archive/restore never touch versions or trade association. Archiving is
// only offered for a strategy that has history and no open draft.
export function setArchived(strategy: Strategy, archived: boolean): Strategy {
  if (archived && (strategy.versions.length === 0 || strategy.draft)) return strategy
  return { ...strategy, status: archived ? 'Archived' : 'Active' }
}
