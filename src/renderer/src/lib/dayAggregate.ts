// Shared day-level aggregation for a set of persisted Trades of one analytical
// day. Sums are exact (scaled BigInt via lib/decimal); nothing here rounds a
// persisted value. Used by the Calendar (month builder) and Day Review, so the
// two surfaces can never disagree about the same day's numbers. Not an
// analytics engine: it only sums/counts fields the trades already carry.

import type { CalendarOutcome } from '@renderer/types/calendar'
import type { TradeSummary } from '@renderer/types/journal'
import { decimalSign, sumDecimalsOrNull, type Decimal } from '@renderer/lib/decimal'
import { tradeCosts, tradeOutcome } from '@renderer/lib/tradeView'

export interface DayAggregate {
  trades: number
  winners: number
  losers: number
  breakEven: number
  /** null when no trade reported the figure (never an invented zero). */
  grossPnl: Decimal | null
  netPnl: Decimal | null
  /** Signed total of reported commission/fees/swap (negative = cost); null when unreported. */
  costs: Decimal | null
  winRate: number | null
  outcome: CalendarOutcome
}

export function outcomeOfTotal(net: Decimal | null): Exclude<CalendarOutcome, 'no-trade'> {
  if (net === null) return 'break-even'
  const sign = decimalSign(net)
  return sign > 0 ? 'positive' : sign < 0 ? 'negative' : 'break-even'
}

export function aggregateDay(dayTrades: readonly TradeSummary[]): DayAggregate {
  const trades = dayTrades.length
  const outcomes = dayTrades.map(tradeOutcome)
  const winners = outcomes.filter((o) => o === 'positive').length
  const losers = outcomes.filter((o) => o === 'negative').length
  const netPnl = sumDecimalsOrNull(dayTrades.map((t) => t.netPnl))
  const winRate = trades > 0 ? Math.round((winners / trades) * 10000) / 100 : null
  return {
    trades,
    winners,
    losers,
    breakEven: trades - winners - losers,
    grossPnl: sumDecimalsOrNull(dayTrades.map((t) => t.grossPnl)),
    netPnl,
    costs: sumDecimalsOrNull(dayTrades.map(tradeCosts)),
    winRate,
    outcome: trades === 0 ? 'no-trade' : outcomeOfTotal(netPnl)
  }
}
