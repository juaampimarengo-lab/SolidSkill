// Display-side compliance helpers. The canonical derivation lives in
// src/shared/compliance.ts (shared with the main process and the tests):
// PASS / (PASS + FAIL); N/A excluded; UNREVIEWED excluded from the percentage
// and makes the review Incomplete. P&L is never an input.

import { addCounts, summarizeCounts, type ComplianceCounts, type ComplianceSummary } from '@shared/compliance'
import type { RuleState } from '@renderer/types/journal'

export type { ComplianceSummary }

export function summarizeRules(states: RuleState[]): ComplianceSummary {
  return summarizeCounts({
    pass: states.filter((s) => s === 'Pass').length,
    fail: states.filter((s) => s === 'Fail').length,
    na: states.filter((s) => s === 'N/A').length,
    unreviewed: states.filter((s) => s === 'Unreviewed').length
  })
}

// Pooled over many trades' rule results — an observation, not a verdict.
export function pooledSummary(all: ComplianceSummary[]): ComplianceSummary {
  return summarizeCounts(addCounts(all))
}

export function formatCompliance(summary: ComplianceSummary): string {
  return summary.percent === null ? '—' : `${summary.percent}%`
}

// Canonical summary for one trade — the single derivation every surface reads,
// from the persisted rule-state counts. Never a stored label, never P&L-dependent.
export function tradeSummary(trade: { compliance: ComplianceCounts }): ComplianceSummary {
  return summarizeCounts(trade.compliance)
}
