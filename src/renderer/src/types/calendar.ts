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
  // Shared-fixture lookup key (e.g. "Sep 15") matching JournalTrade.date —
  // present only for in-month cells backed by real fixture trades, since
  // that's the only case a day is navigable to Day Review.
  dateKey?: string
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
