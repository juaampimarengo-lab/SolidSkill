// Static shapes for Checkpoint 003's dummy data only. Not a domain model —
// the real Trading Domain / Strategy Engine types land in a later checkpoint.

export type Outcome = 'positive' | 'negative' | 'break-even'

export interface RecentTrade {
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
  compliance: 'Compliant' | 'Violation' | 'Partial'
}

export interface DayPerformance {
  label: string
  pnl: number
  outcome: Outcome
}

export interface CalendarDay {
  date: number
  inMonth: boolean
  pnl: number | null
  trades: number
  outcome: Outcome | 'none'
  hasNote?: boolean
  isToday?: boolean
}

export interface ChecklistRule {
  name: string
  state: 'Pass' | 'Fail' | 'N/A'
}

export interface EquityPoint {
  x: number
  y: number
}
