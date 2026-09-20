import type { ComplianceSummary } from '@renderer/lib/compliance'

// Static shapes for Checkpoint 003's dummy data only. Not a domain model —
// the real Trading Domain / Strategy Engine types land in a later checkpoint.

export type Outcome = 'positive' | 'negative' | 'break-even'

export interface RecentTrade {
  // Canonical fixture id — resolves to the same Trade shown in Journal /
  // Day Review / Trade Review (docs/JOURNAL_SPEC.md).
  id: string
  time: string
  instrument: string
  side: 'Long' | 'Short'
  qty: number
  entry: number
  exit: number
  resultUsd: number
  outcome: Outcome
  r: number
  strategy: string
  compliance: ComplianceSummary
}

export interface DayPerformance {
  label: string
  pnl: number
  outcome: Outcome
}

export interface ChecklistRule {
  name: string
  state: 'Pass' | 'Fail' | 'N/A'
}

export interface EquityPoint {
  x: number
  y: number
}
