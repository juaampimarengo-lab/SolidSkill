// View shapes for the Calendar workspace. Every cell is derived from persisted
// Trades grouped by their analytical trading date (see lib/calendar.ts) — no
// fixture data, no timestamp-to-date conversion. Money is an exact decimal
// string. The break-even classification is a temporary fixed default (see
// lib/tradeView.ts) until the configurable threshold in docs/CALENDAR_SPEC.md
// §12 exists.

import type { Decimal } from '@renderer/lib/decimal'

export type CalendarOutcome = 'positive' | 'negative' | 'break-even' | 'no-trade'

export interface CalendarDayCell {
  date: number
  inMonth: boolean
  isToday?: boolean
  outcome: CalendarOutcome
  result: Decimal | null
  trades: number
  winRate: number | null
  hasJournalEntry?: boolean
  // Analytical trading date ('YYYY-MM-DD') — present only for in-month cells
  // that have persisted trades, since that's the only case a day is navigable
  // to Day Review.
  dateKey?: string
}

export interface WeeklySummaryData {
  label: string
  outcome: CalendarOutcome
  result: Decimal
  tradedDays: number
}

export interface MonthlyStats {
  result: Decimal
  outcome: Exclude<CalendarOutcome, 'no-trade'>
  tradedDays: number
}

export interface CalendarMonthData {
  monthLabel: string
  monthlyStats: MonthlyStats
  weeks: CalendarDayCell[][]
  weeklySummaries: WeeklySummaryData[]
}
