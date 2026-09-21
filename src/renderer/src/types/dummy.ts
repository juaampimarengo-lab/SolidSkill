// Static shapes for Checkpoint 003's dummy data only. Not a domain model —
// the real Trading Domain / Strategy Engine types land in a later checkpoint.

export type Outcome = 'positive' | 'negative' | 'break-even'

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
