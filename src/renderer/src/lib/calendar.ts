// Builds Calendar month grids from persisted Trades. A day is populated only if
// persisted Trades carry that analytical trading date; dates without trades are
// genuine no-trade cells (so nothing can appear after the last persisted trade).
//
// Date math is pure calendar arithmetic (UTC constructors used only for
// weekday/length of a month, never for a trade's own date), so no browser
// timezone can shift a cell or a trade to another day.

import { aggregateDay, outcomeOfTotal } from '@renderer/lib/dayAggregate'
import { sumDecimals } from '@renderer/lib/decimal'
import type { CalendarDayCell, CalendarMonthData, MonthlyStats, WeeklySummaryData } from '@renderer/types/calendar'
import type { TradeSummary } from '@renderer/types/journal'

export interface MonthRef {
  year: number
  /** 1-12 */
  month: number
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

const pad = (n: number): string => String(n).padStart(2, '0')
const monthKey = (m: MonthRef): string => `${m.year}-${pad(m.month)}`
const addMonths = (m: MonthRef, n: number): MonthRef => {
  const index = m.year * 12 + (m.month - 1) + n
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** The wall-clock date of "today" as 'YYYY-MM-DD' (a display marker only). */
export function todayIsoDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function monthOfIso(isoDate: string): MonthRef {
  return { year: Number(isoDate.slice(0, 4)), month: Number(isoDate.slice(5, 7)) }
}

/**
 * Navigable months: from the earliest of (first trade month, current month)
 * through one month past the later of (last trade month, current month).
 */
export function calendarRange(trades: readonly TradeSummary[], todayIso: string): MonthRef[] {
  const current = monthOfIso(todayIso)
  let first = current
  let last = current
  for (const trade of trades) {
    const m = monthOfIso(trade.tradeDate)
    if (monthKey(m) < monthKey(first)) first = m
    if (monthKey(m) > monthKey(last)) last = m
  }
  const months: MonthRef[] = []
  for (let m = first; monthKey(m) <= monthKey(addMonths(last, 1)); m = addMonths(m, 1)) months.push(m)
  return months
}

export function groupByDate(trades: readonly TradeSummary[]): Map<string, TradeSummary[]> {
  const byDate = new Map<string, TradeSummary[]>()
  for (const trade of trades) {
    const list = byDate.get(trade.tradeDate) ?? []
    list.push(trade)
    byDate.set(trade.tradeDate, list)
  }
  return byDate
}

function outsideCell(date: number): CalendarDayCell {
  return { date, inMonth: false, outcome: 'no-trade', result: null, trades: 0, winRate: null }
}

export function buildCalendarMonth(
  ref: MonthRef,
  tradesByDate: ReadonlyMap<string, TradeSummary[]>,
  noteDates: ReadonlySet<string>,
  todayIso: string
): CalendarMonthData {
  const firstWeekday = new Date(Date.UTC(ref.year, ref.month - 1, 1)).getUTCDay() // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(ref.year, ref.month, 0)).getUTCDate()
  const daysInPrevious = new Date(Date.UTC(ref.year, ref.month - 1, 0)).getUTCDate()

  const cells: CalendarDayCell[] = []
  for (let i = 0; i < firstWeekday; i += 1) cells.push(outsideCell(daysInPrevious - firstWeekday + 1 + i))
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${monthKey(ref)}-${pad(day)}`
    const dayTrades = tradesByDate.get(iso) ?? []
    if (dayTrades.length === 0) {
      cells.push({ date: day, inMonth: true, outcome: 'no-trade', result: null, trades: 0, winRate: null, isToday: iso === todayIso })
      continue
    }
    const agg = aggregateDay(dayTrades)
    cells.push({
      date: day,
      inMonth: true,
      outcome: agg.outcome,
      result: agg.netPnl,
      trades: agg.trades,
      winRate: agg.winRate,
      hasJournalEntry: noteDates.has(iso),
      isToday: iso === todayIso,
      dateKey: iso
    })
  }
  for (let trailing = 1; cells.length % 7 !== 0; trailing += 1) cells.push(outsideCell(trailing))

  const weeks: CalendarDayCell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const tradedCells = cells.filter((c) => c.inMonth && c.trades > 0)
  const monthTotal = sumDecimals(tradedCells.map((c) => c.result))
  const monthlyStats: MonthlyStats = {
    result: monthTotal,
    outcome: outcomeOfTotal(monthTotal),
    tradedDays: tradedCells.length
  }
  const weeklySummaries: WeeklySummaryData[] = weeks.map((week, i) => {
    const traded = week.filter((c) => c.trades > 0)
    const result = sumDecimals(traded.map((c) => c.result))
    return {
      label: `Week ${i + 1}`,
      outcome: traded.length === 0 ? 'no-trade' : outcomeOfTotal(result),
      result,
      tradedDays: traded.length
    }
  })

  return { monthLabel: `${MONTH_NAMES[ref.month - 1]} ${ref.year}`, monthlyStats, weeks, weeklySummaries }
}
