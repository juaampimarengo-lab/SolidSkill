// Static shapes for the Checkpoint 010 Strategy Builder workspace (session-
// local UI state over static fixtures). Not the production Strategy Engine
// model — no persistence, no evaluation engine. Every name/label here is
// USER DATA (generic fixtures like "Strategy Alpha"/"Rule A"); nothing
// methodology-specific is a type or enum. See docs/STRATEGY_BUILDER_SPEC.md
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
  versions: readonly StrategyVersion[]
  draft: StrategyDraft | null
}
