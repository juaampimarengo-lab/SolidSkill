// Calendar Workspace fixture data (Checkpoint 008). Every in-month day
// cell is derived from the shared journalTrades fixtures (journalDummyData.ts)
// via aggregateDay — Calendar and Journal/Day Review can never disagree
// about the same day's numbers, per CLAUDE.md checkpoint instructions
// ("SHARED DUMMY DATA"). A day with no fixture trades is a genuine
// no-trade cell; this includes every date after Sep 16, 2026 (today, the
// review date), since no trade fixture exists past that date — see
// "FIX THE FUTURE-DATE DUMMY-DATA ISSUE."
//
// No calculation here is a real aggregation engine — see docs/CALENDAR_SPEC.md
// §15. This module only sums/counts already-computed JournalTrade fields.

import { aggregateDay } from '@renderer/lib/dayAggregate'
import { journalTrades } from '@renderer/data/journalDummyData'
import type { CalendarDayCell, CalendarMonthData, MonthlyStats, WeeklySummaryData } from '@renderer/types/calendar'
import type { JournalTrade } from '@renderer/types/journal'

const TODAY_KEY = 'Sep 16'

const tradesByDate = new Map<string, JournalTrade[]>()
for (const trade of journalTrades) {
  const list = tradesByDate.get(trade.date) ?? []
  list.push(trade)
  tradesByDate.set(trade.date, list)
}

function outsideCell(date: number): CalendarDayCell {
  return { date, inMonth: false, outcome: 'no-trade', result: null, trades: 0, winRate: null }
}

function inMonthCell(date: number, monthAbbr: string): CalendarDayCell {
  const dateKey = `${monthAbbr} ${date}`
  const dayTrades = (tradesByDate.get(dateKey) ?? [])
    .slice()
    .sort((a, b) => a.openTime.localeCompare(b.openTime))

  if (dayTrades.length === 0) {
    return {
      date,
      inMonth: true,
      outcome: 'no-trade',
      result: null,
      trades: 0,
      winRate: null,
      isToday: dateKey === TODAY_KEY
    }
  }

  const agg = aggregateDay(dayTrades)
  return {
    date,
    inMonth: true,
    outcome: agg.outcome,
    result: agg.netPnl,
    trades: agg.trades,
    winRate: agg.winRate,
    hasJournalEntry: dayTrades.some((t) => Boolean(t.dayNote)),
    isToday: dateKey === TODAY_KEY,
    dateKey
  }
}

function chunk7(cells: CalendarDayCell[]): CalendarDayCell[][] {
  const weeks: CalendarDayCell[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return weeks
}

function monthlyStats(weeks: CalendarDayCell[][]): MonthlyStats {
  const tradedDayCells = weeks.flat().filter((c) => c.inMonth && c.trades > 0)
  return {
    result: tradedDayCells.reduce((sum, c) => sum + (c.result ?? 0), 0),
    tradedDays: tradedDayCells.length
  }
}

function weeklySummaries(weeks: CalendarDayCell[][]): WeeklySummaryData[] {
  return weeks.map((week, i) => {
    const traded = week.filter((c) => c.trades > 0)
    const result = traded.reduce((sum, c) => sum + (c.result ?? 0), 0)
    const outcome = traded.length === 0 ? 'no-trade' : result > 0 ? 'positive' : result < 0 ? 'negative' : 'break-even'
    return { label: `Week ${i + 1}`, outcome, result, tradedDays: traded.length }
  })
}

// ---------------------------------------------------------------------
// September 2026 — the primary/current dummy month. Sept 1, 2026 falls on
// a Tuesday. Today is Sep 16, 2026.
// ---------------------------------------------------------------------

const septemberCells: CalendarDayCell[] = [
  // Week 1 — trailing August days + Sep 1-5
  outsideCell(30),
  outsideCell(31),
  inMonthCell(1, 'Sep'),
  inMonthCell(2, 'Sep'),
  inMonthCell(3, 'Sep'),
  inMonthCell(4, 'Sep'),
  inMonthCell(5, 'Sep'),

  // Week 2 — Sep 6-12
  inMonthCell(6, 'Sep'),
  inMonthCell(7, 'Sep'),
  inMonthCell(8, 'Sep'),
  inMonthCell(9, 'Sep'),
  inMonthCell(10, 'Sep'),
  inMonthCell(11, 'Sep'),
  inMonthCell(12, 'Sep'),

  // Week 3 — Sep 13-19
  inMonthCell(13, 'Sep'),
  inMonthCell(14, 'Sep'),
  inMonthCell(15, 'Sep'),
  inMonthCell(16, 'Sep'),
  inMonthCell(17, 'Sep'),
  inMonthCell(18, 'Sep'),
  inMonthCell(19, 'Sep'),

  // Week 4 — Sep 20-26
  inMonthCell(20, 'Sep'),
  inMonthCell(21, 'Sep'),
  inMonthCell(22, 'Sep'),
  inMonthCell(23, 'Sep'),
  inMonthCell(24, 'Sep'),
  inMonthCell(25, 'Sep'),
  inMonthCell(26, 'Sep'),

  // Week 5 — Sep 27-30 + leading October days
  inMonthCell(27, 'Sep'),
  inMonthCell(28, 'Sep'),
  inMonthCell(29, 'Sep'),
  inMonthCell(30, 'Sep'),
  outsideCell(1),
  outsideCell(2),
  outsideCell(3)
]

const septemberWeeks = chunk7(septemberCells)

const september2026: CalendarMonthData = {
  monthLabel: 'September 2026',
  monthlyStats: monthlyStats(septemberWeeks),
  weeks: septemberWeeks,
  weeklySummaries: weeklySummaries(septemberWeeks)
}

// ---------------------------------------------------------------------
// August 2026 — sparser prior month, demonstrates month navigation with a
// different data shape. Aug 1, 2026 falls on a Saturday.
// ---------------------------------------------------------------------

const augustCells: CalendarDayCell[] = [
  // Week 1 — trailing July + Aug 1
  outsideCell(26),
  outsideCell(27),
  outsideCell(28),
  outsideCell(29),
  outsideCell(30),
  outsideCell(31),
  inMonthCell(1, 'Aug'),

  // Week 2 — Aug 2-8
  inMonthCell(2, 'Aug'),
  inMonthCell(3, 'Aug'),
  inMonthCell(4, 'Aug'),
  inMonthCell(5, 'Aug'),
  inMonthCell(6, 'Aug'),
  inMonthCell(7, 'Aug'),
  inMonthCell(8, 'Aug'),

  // Week 3 — Aug 9-15
  inMonthCell(9, 'Aug'),
  inMonthCell(10, 'Aug'),
  inMonthCell(11, 'Aug'),
  inMonthCell(12, 'Aug'),
  inMonthCell(13, 'Aug'),
  inMonthCell(14, 'Aug'),
  inMonthCell(15, 'Aug'),

  // Week 4 — Aug 16-22
  inMonthCell(16, 'Aug'),
  inMonthCell(17, 'Aug'),
  inMonthCell(18, 'Aug'),
  inMonthCell(19, 'Aug'),
  inMonthCell(20, 'Aug'),
  inMonthCell(21, 'Aug'),
  inMonthCell(22, 'Aug'),

  // Week 5 — Aug 23-29
  inMonthCell(23, 'Aug'),
  inMonthCell(24, 'Aug'),
  inMonthCell(25, 'Aug'),
  inMonthCell(26, 'Aug'),
  inMonthCell(27, 'Aug'),
  inMonthCell(28, 'Aug'),
  inMonthCell(29, 'Aug'),

  // Week 6 — Aug 30-31 + leading September days
  inMonthCell(30, 'Aug'),
  inMonthCell(31, 'Aug'),
  outsideCell(1),
  outsideCell(2),
  outsideCell(3),
  outsideCell(4),
  outsideCell(5)
]

const augustWeeks = chunk7(augustCells)

const august2026: CalendarMonthData = {
  monthLabel: 'August 2026',
  monthlyStats: monthlyStats(augustWeeks),
  weeks: augustWeeks,
  weeklySummaries: weeklySummaries(augustWeeks)
}

// ---------------------------------------------------------------------
// October 2026 — an upcoming month with no realized activity yet (no
// fixture trade is ever dated after Sep 16, 2026 — see journalDummyData.ts),
// so every in-month cell resolves to the no-trade state automatically.
// Oct 1, 2026 falls on a Thursday.
// ---------------------------------------------------------------------

const octoberCells: CalendarDayCell[] = [
  outsideCell(27),
  outsideCell(28),
  outsideCell(29),
  outsideCell(30),
  ...Array.from({ length: 31 }, (_, i) => inMonthCell(i + 1, 'Oct'))
]

const octoberWeeks = chunk7(octoberCells)

const october2026: CalendarMonthData = {
  monthLabel: 'October 2026',
  monthlyStats: monthlyStats(octoberWeeks),
  weeks: octoberWeeks,
  weeklySummaries: weeklySummaries(octoberWeeks)
}

// Ordered so month navigation is a simple index walk. September is the
// "current" dummy month ("This month" always returns to this index).
export const calendarMonths: CalendarMonthData[] = [august2026, september2026, october2026]
export const currentMonthIndex = 1
