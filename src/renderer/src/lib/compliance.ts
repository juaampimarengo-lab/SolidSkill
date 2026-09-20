// Display-only compliance derivation from per-rule evaluation states.
// Formula (docs/STRATEGY_BUILDER_SPEC.md §10): PASS / (PASS + FAIL).
// N/A and UNREVIEWED are excluded from the percentage; UNREVIEWED is
// surfaced separately as "Review: Incomplete". P&L is never an input.

import type { RuleState } from '@renderer/types/journal'

export interface ComplianceSummary {
  pass: number
  fail: number
  na: number
  unreviewed: number
  total: number
  // null when PASS + FAIL = 0 — undefined, never rendered as 0% or 100%.
  percent: number | null
  // PASS + FAIL: the applicable, evaluated rules (the percentage denominator).
  evaluated: number
  reviewed: number
  // true only when no rule is UNREVIEWED. Independent of the percentage.
  reviewComplete: boolean
}

export function summarizeRules(states: RuleState[]): ComplianceSummary {
  const pass = states.filter((s) => s === 'Pass').length
  const fail = states.filter((s) => s === 'Fail').length
  const na = states.filter((s) => s === 'N/A').length
  const unreviewed = states.filter((s) => s === 'Unreviewed').length
  const total = states.length
  return {
    pass,
    fail,
    na,
    unreviewed,
    total,
    percent: pass + fail === 0 ? null : Math.round((pass / (pass + fail)) * 100),
    evaluated: pass + fail,
    reviewed: total - unreviewed,
    reviewComplete: unreviewed === 0
  }
}

// Pooled over many trades' rule results — an observation, not a verdict.
export function pooledSummary(all: ComplianceSummary[]): ComplianceSummary {
  const pass = all.reduce((n, s) => n + s.pass, 0)
  const fail = all.reduce((n, s) => n + s.fail, 0)
  const na = all.reduce((n, s) => n + s.na, 0)
  const unreviewed = all.reduce((n, s) => n + s.unreviewed, 0)
  const total = pass + fail + na + unreviewed
  return {
    pass,
    fail,
    na,
    unreviewed,
    total,
    percent: pass + fail === 0 ? null : Math.round((pass / (pass + fail)) * 100),
    evaluated: pass + fail,
    reviewed: total - unreviewed,
    reviewComplete: unreviewed === 0
  }
}

export function formatCompliance(summary: ComplianceSummary): string {
  return summary.percent === null ? '—' : `${summary.percent}%`
}

// Canonical summary for one trade's rule results — the single derivation every
// surface reads. Never a stored label, never P&L-dependent.
export function tradeSummary(rules: { state: RuleState }[]): ComplianceSummary {
  return summarizeRules(rules.map((r) => r.state))
}
