// Static shapes for the Checkpoint 005 Calendar workspace's dummy data only.
// Not a domain model — no calculation, classification, or persistence logic
// is implied by these types. Real values (result, trade count, win rate,
// outcome classification) will eventually come from the Trading Domain /
// Strategy Engine and a configurable break-even threshold (see
// docs/CALENDAR_SPEC.md §9, §12), not from this workspace.

export type CalendarOutcome = 'positive' | 'negative' | 'break-even' | 'no-trade'

export interface CalendarDayCell {
  date: number
  inMonth: boolean
  isToday?: boolean
  outcome: CalendarOutcome
  result: number | null
  trades: number
  winRate: number | null
  hasJournalEntry?: boolean
}

export interface WeeklySummaryData {
  label: string
  outcome: CalendarOutcome
  result: number
  tradedDays: number
}

export interface MonthlyStats {
  result: number
  tradedDays: number
}

export interface CalendarMonthData {
  monthLabel: string
  monthlyStats: MonthlyStats
  weeks: CalendarDayCell[][]
  weeklySummaries: WeeklySummaryData[]
}
