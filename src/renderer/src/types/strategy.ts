// Renderer view model for the Strategy Builder workspace. Strategy data is
// persisted in SQLite by the main process and arrives over the typed preload
// API (src/shared/ipc/strategies.ts, mapped in lib/strategyMapping.ts); these
// shapes are what the UI renders, not persistence rows. Every name/label here
// is USER DATA (e.g. "Strategy Alpha"/"Rule A"); nothing methodology-specific
// is a type or enum. See docs/STRATEGY_BUILDER_SPEC.md
// and docs/STRATEGY_VERSIONING.md.

export type RuleKind = 'Required' | 'Optional' | 'Conditional'
export const ruleKinds: RuleKind[] = ['Required', 'Optional', 'Conditional']

export interface RuleDef {
  id: string
  name: string
  description: string
  // Conceptual only in V1 — never affects compliance (docs/STRATEGY_BUILDER_SPEC.md §11).
  kind: RuleKind
}

export interface RuleGroupDef {
  id: string
  name: string
  rules: RuleDef[]
}

// A published Version is frozen: its groups are deep-frozen at creation and
// no code path replaces or edits a published version in place.
export interface StrategyVersion {
  // Persisted id: the stable identity Trades associate with (never the number or a name).
  readonly id: string
  readonly number: number
  readonly publishedOn: string
  readonly groups: readonly RuleGroupDef[]
  // Human-readable change lines. Fixture text for seeded versions; a tiny
  // rule-level summary for session-published ones (not a diff engine).
  readonly changes: readonly string[]
}

// The ONE logic Draft per Strategy: rule groups/rules only. Name and
// description are Strategy-level metadata (Strategy.name/description), edited
// directly and never part of the Draft.
export interface StrategyDraft {
  // null = never-published strategy (no version to be "based on").
  basedOn: number | null
  groups: RuleGroupDef[]
}

export type StrategyStatus = 'Active' | 'Archived'

export interface Strategy {
  id: string
  name: string
  description: string
  status: StrategyStatus
  // Manual order within its status section (0 = top). List presentation only:
  // never versioned, never part of a Draft.
  position: number
  versions: readonly StrategyVersion[]
  draft: StrategyDraft | null
}
