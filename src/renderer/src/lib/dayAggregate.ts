// Shared day-level aggregation for a set of already-classified JournalTrade
// fixtures. Not a real analytics/aggregation engine — every input value
// (netPnl, grossPnl, fees, outcome) is already a precomputed fixture field;
// this only sums/counts what's already there. Used by both the Calendar
// fixture generator (build time) and Day Review (render time) so the two
// surfaces can never disagree about the same day's numbers.

import type { CalendarOutcome } from '@renderer/types/calendar'
import type { JournalTrade } from '@renderer/types/journal'

export interface DayAggregate {
  trades: number
  winners: number
  losers: number
  breakEven: number
  grossPnl: number
  netPnl: number
  fees: number
  winRate: number | null
  outcome: CalendarOutcome
}

export function aggregateDay(dayTrades: JournalTrade[]): DayAggregate {
  const trades = dayTrades.length
  const winners = dayTrades.filter((t) => t.outcome === 'positive').length
  const losers = dayTrades.filter((t) => t.outcome === 'negative').length
  const breakEven = trades - winners - losers
  const grossPnl = dayTrades.reduce((sum, t) => sum + t.grossPnl, 0)
  const netPnl = dayTrades.reduce((sum, t) => sum + t.netPnl, 0)
  const fees = dayTrades.reduce((sum, t) => sum + t.fees, 0)
  const winRate = trades > 0 ? Math.round((winners / trades) * 10000) / 100 : null
  const outcome: CalendarOutcome = trades === 0 ? 'no-trade' : netPnl > 0 ? 'positive' : netPnl < 0 ? 'negative' : 'break-even'

  return { trades, winners, losers, breakEven, grossPnl, netPnl, fees, winRate, outcome }
}
