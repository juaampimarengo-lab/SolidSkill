/**
 * Canonical rule-compliance derivation, shared by main and renderer so every
 * surface (and the tests) read the same definition.
 *
 * Formula (docs/STRATEGY_BUILDER_SPEC.md §10): PASS / (PASS + FAIL).
 * N/A is excluded. UNREVIEWED is excluded from the percentage and makes the
 * review Incomplete. P&L is never an input. There are no categorical
 * "compliant / violation / partial" states.
 */

export interface ComplianceCounts {
  pass: number
  fail: number
  na: number
  unreviewed: number
}

export interface ComplianceSummary extends ComplianceCounts {
  total: number
  /** null when PASS + FAIL = 0 — undefined, never rendered as 0% or 100%. */
  percent: number | null
  /** PASS + FAIL: the applicable, evaluated rules (the percentage denominator). */
  evaluated: number
  reviewed: number
  /** true only when no rule is UNREVIEWED. Independent of the percentage. */
  reviewComplete: boolean
}

export function summarizeCounts(counts: ComplianceCounts): ComplianceSummary {
  const { pass, fail, na, unreviewed } = counts
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

export function addCounts(all: readonly ComplianceCounts[]): ComplianceCounts {
  return all.reduce<ComplianceCounts>(
    (sum, c) => ({
      pass: sum.pass + c.pass,
      fail: sum.fail + c.fail,
      na: sum.na + c.na,
      unreviewed: sum.unreviewed + c.unreviewed
    }),
    { pass: 0, fail: 0, na: 0, unreviewed: 0 }
  )
}
