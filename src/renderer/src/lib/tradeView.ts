// Pure presentation helpers over the persisted Trade view models. Nothing here
// reconstructs a trade, infers direction, or touches persistence.
//
// Timestamps vs analytical date: `openedAt`/`executedAt` are UTC epoch
// milliseconds shown as wall-clock time in the account's timezone (never the
// browser's). The analytical trading date is a separate persisted fact used
// for all day grouping; it is only ever parsed as text, never via `Date`, so
// no timezone conversion can move a trade to the previous/next day.

import type { ComplianceSummary } from '@renderer/lib/compliance'
import { tradeSummary } from '@renderer/lib/compliance'
import { absDecimal, decimalLessThan, decimalSign, sumDecimalsOrNull } from '@renderer/lib/decimal'
import type { Direction, ExecutionSide, Outcome, TradeExecution, TradeSummary } from '@renderer/types/journal'

/**
 * TEMPORARY fixed default until the configurable break-even threshold
 * (docs/CALENDAR_SPEC.md §12) exists: a net result smaller in magnitude than
 * this (account currency units) is "break-even". Presentation-only — never
 * stored, so it can never alter a persisted fact.
 */
export const BREAK_EVEN_THRESHOLD = '10'

export function tradeOutcome(trade: { netPnl: string | null }): Outcome {
  if (trade.netPnl === null) return 'break-even'
  if (decimalLessThan(absDecimal(trade.netPnl), BREAK_EVEN_THRESHOLD)) return 'break-even'
  return decimalSign(trade.netPnl) > 0 ? 'positive' : 'negative'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM-DD' -> 'Sep 15'. Pure text manipulation. */
export function dateLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  return `${MONTHS[Number(month) - 1] ?? '?'} ${Number(day)}`
}

/** 'YYYY-MM-DD' -> 'Sep 15, 2026'. */
export function longDateLabel(isoDate: string): string {
  return `${dateLabel(isoDate)}, ${isoDate.slice(0, 4)}`
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timezone: string | null): Intl.DateTimeFormat {
  const key = timezone ?? 'UTC'
  let formatter = formatters.get(key)
  if (formatter === undefined) {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }
    try {
      formatter = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: key })
    } catch {
      formatter = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' })
    }
    formatters.set(key, formatter)
  }
  return formatter
}

/** Wall-clock 'HH:MM:SS' of an instant in the account's timezone (UTC when unknown). */
export function clockTime(epochMs: number, timezone: string | null): string {
  return formatterFor(timezone).format(new Date(epochMs))
}

export function openTimeLabel(trade: Pick<TradeSummary, 'openedAt' | 'timezone'>): string {
  return clockTime(trade.openedAt, trade.timezone)
}

export function closeTimeLabel(trade: Pick<TradeSummary, 'closedAt' | 'timezone'>): string {
  return trade.closedAt === null ? '—' : clockTime(trade.closedAt, trade.timezone)
}

export function durationLabel(trade: Pick<TradeSummary, 'openedAt' | 'closedAt'>): string {
  if (trade.closedAt === null) return '—'
  const total = Math.max(0, Math.round((trade.closedAt - trade.openedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

/** Signed total of the reported cost categories (negative = cost); null when none were reported. */
export function tradeCosts(trade: Pick<TradeSummary, 'commission' | 'fees' | 'swap'>): string | null {
  return sumDecimalsOrNull([trade.commission, trade.fees, trade.swap])
}

export function complianceOf(trade: Pick<TradeSummary, 'compliance'>): ComplianceSummary {
  return tradeSummary(trade)
}

export function strategyName(trade: Pick<TradeSummary, 'strategy'>): string {
  return trade.strategy?.strategyName ?? '—'
}

export function versionLabel(trade: Pick<TradeSummary, 'strategy'>): string {
  return trade.strategy === null ? '—' : `v${trade.strategy.versionNumber}`
}

// Entries/exits are read from the trade's persisted direction (the side that
// opened the exposure), never from which execution appears last — see
// docs/TRADE_MODEL_CONCEPTS.md §5.
export function openingSide(direction: Direction): ExecutionSide {
  return direction === 'Long' ? 'BUY' : 'SELL'
}

export function countEntries(executions: readonly TradeExecution[], direction: Direction): number {
  const opening = openingSide(direction)
  return executions.filter((e) => e.side === opening).length
}

export function countExits(executions: readonly TradeExecution[], direction: Direction): number {
  const opening = openingSide(direction)
  return executions.filter((e) => e.side !== opening).length
}

export function outcomeNumClass(outcome: Outcome | 'no-trade'): string {
  if (outcome === 'break-even' || outcome === 'no-trade') return 'num--neutral'
  return `num--${outcome}`
}
