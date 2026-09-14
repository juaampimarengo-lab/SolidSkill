// Static dummy data for the Calendar workspace (Checkpoint 005). Values are
// hand-authored, not derived from any trade/day/week relationship — the
// point of this checkpoint is visual rendering, not calculation
// correctness. Real aggregation, outcome classification, and win-rate
// calculation are out of scope here (see docs/CALENDAR_SPEC.md §15).

import type { CalendarDayCell, CalendarMonthData } from '@renderer/types/calendar'

function day(
  date: number,
  inMonth: boolean,
  overrides: Partial<Omit<CalendarDayCell, 'date' | 'inMonth'>> = {}
): CalendarDayCell {
  return {
    date,
    inMonth,
    outcome: 'no-trade',
    result: null,
    trades: 0,
    winRate: null,
    ...overrides
  }
}

function chunk7(cells: CalendarDayCell[]): CalendarDayCell[][] {
  const weeks: CalendarDayCell[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return weeks
}

// ---------------------------------------------------------------------
// September 2026 — the primary dummy month (matches the CALENDAR_SPEC
// worked example on day 14: +$556 / 3 trades / 33.33% / journal entry).
// Sept 1, 2026 falls on a Tuesday.
// ---------------------------------------------------------------------

const septemberCells: CalendarDayCell[] = [
  // Week 1 — trailing August days + Sep 1-5
  day(30, false),
  day(31, false),
  day(1, true, { outcome: 'positive', result: 715, trades: 2, winRate: 50 }),
  day(2, true, { outcome: 'negative', result: -340, trades: 1, winRate: 0 }),
  day(3, true),
  day(4, true, { outcome: 'break-even', result: 0, trades: 2, winRate: 50 }),
  day(5, true),

  // Week 2 — Sep 6-12
  day(6, true),
  day(7, true, { outcome: 'positive', result: 482, trades: 1, winRate: 100 }),
  day(8, true, { outcome: 'negative', result: -214.5, trades: 3, winRate: 33.33 }),
  day(9, true),
  day(10, true, { outcome: 'positive', result: 916.25, trades: 6, winRate: 66.67, hasJournalEntry: true }),
  day(11, true, { outcome: 'break-even', result: 0, trades: 1, winRate: 0 }),
  day(12, true),

  // Week 3 — Sep 13-19
  day(13, true),
  day(14, true, {
    outcome: 'positive',
    result: 556,
    trades: 3,
    winRate: 33.33,
    hasJournalEntry: true,
    isToday: true
  }),
  day(15, true, { outcome: 'negative', result: -488.25, trades: 4, winRate: 25 }),
  day(16, true, { outcome: 'positive', result: 220.5, trades: 3, winRate: 66.67 }),
  day(17, true),
  day(18, true, { outcome: 'positive', result: 340, trades: 3, winRate: 100 }),
  day(19, true),

  // Week 4 — Sep 20-26
  day(20, true),
  day(21, true, { outcome: 'break-even', result: 0, trades: 1, winRate: 0 }),
  day(22, true, { outcome: 'negative', result: -152, trades: 2, winRate: 0 }),
  day(23, true, { outcome: 'positive', result: 812.5, trades: 5, winRate: 80 }),
  day(24, true, { outcome: 'positive', result: 118.25, trades: 2, winRate: 50 }),
  day(25, true),
  day(26, true),

  // Week 5 — Sep 27-30 + leading October days
  day(27, true),
  day(28, true, { outcome: 'negative', result: -64, trades: 1, winRate: 0 }),
  day(29, true, { outcome: 'positive', result: 540, trades: 4, winRate: 75 }),
  day(30, true, { outcome: 'positive', result: 1842.5, trades: 6, winRate: 83.33, hasJournalEntry: true }),
  day(1, false),
  day(2, false),
  day(3, false)
]

const september2026: CalendarMonthData = {
  monthLabel: 'September 2026',
  monthlyStats: { result: 5130, tradedDays: 13 },
  weeks: chunk7(septemberCells),
  weeklySummaries: [
    { label: 'Week 1', outcome: 'positive', result: 482, tradedDays: 1 },
    { label: 'Week 2', outcome: 'positive', result: 1050, tradedDays: 4 },
    { label: 'Week 3', outcome: 'negative', result: -320, tradedDays: 3 },
    { label: 'Week 4', outcome: 'break-even', result: 0, tradedDays: 2 },
    { label: 'Week 5', outcome: 'positive', result: 2318, tradedDays: 3 }
  ]
}

// ---------------------------------------------------------------------
// August 2026 — sparser prior month, demonstrates month navigation with a
// different data shape. Aug 1, 2026 falls on a Saturday.
// ---------------------------------------------------------------------

const augustCells: CalendarDayCell[] = [
  // Week 1 — trailing July + Aug 1
  day(26, false),
  day(27, false),
  day(28, false),
  day(29, false),
  day(30, false),
  day(31, false),
  day(1, true),

  // Week 2 — Aug 2-8
  day(2, true),
  day(3, true, { outcome: 'positive', result: 268, trades: 2, winRate: 50 }),
  day(4, true, { outcome: 'negative', result: -190, trades: 1, winRate: 0 }),
  day(5, true),
  day(6, true),
  day(7, true, { outcome: 'positive', result: 604.5, trades: 4, winRate: 75 }),
  day(8, true),

  // Week 3 — Aug 9-15
  day(9, true),
  day(10, true, { outcome: 'break-even', result: 0, trades: 1, winRate: 0 }),
  day(11, true),
  day(12, true, { outcome: 'positive', result: 388, trades: 3, winRate: 66.67, hasJournalEntry: true }),
  day(13, true),
  day(14, true),
  day(15, true),

  // Week 4 — Aug 16-22
  day(16, true, { outcome: 'negative', result: -96, trades: 2, winRate: 0 }),
  day(17, true),
  day(18, true, { outcome: 'positive', result: 512, trades: 3, winRate: 66.67 }),
  day(19, true),
  day(20, true),
  day(21, true, { outcome: 'negative', result: -260, trades: 2, winRate: 50 }),
  day(22, true),

  // Week 5 — Aug 23-29
  day(23, true),
  day(24, true, { outcome: 'positive', result: 175, trades: 1, winRate: 100 }),
  day(25, true),
  day(26, true),
  day(27, true, { outcome: 'positive', result: 940, trades: 5, winRate: 80, hasJournalEntry: true }),
  day(28, true),
  day(29, true),

  // Week 6 — Aug 30-31 + leading September days
  day(30, true),
  day(31, true, { outcome: 'negative', result: -145, trades: 1, winRate: 0 }),
  day(1, false),
  day(2, false),
  day(3, false),
  day(4, false),
  day(5, false)
]

const august2026: CalendarMonthData = {
  monthLabel: 'August 2026',
  monthlyStats: { result: 2996.5, tradedDays: 10 },
  weeks: chunk7(augustCells),
  weeklySummaries: [
    { label: 'Week 1', outcome: 'no-trade', result: 0, tradedDays: 0 },
    { label: 'Week 2', outcome: 'positive', result: 682.5, tradedDays: 3 },
    { label: 'Week 3', outcome: 'positive', result: 388, tradedDays: 2 },
    { label: 'Week 4', outcome: 'positive', result: 156, tradedDays: 3 },
    { label: 'Week 5', outcome: 'positive', result: 1115, tradedDays: 2 },
    { label: 'Week 6', outcome: 'negative', result: -145, tradedDays: 1 }
  ]
}

// ---------------------------------------------------------------------
// October 2026 — an upcoming month with no realized activity yet, to
// demonstrate the all-no-trade empty state. Oct 1, 2026 falls on a
// Thursday.
// ---------------------------------------------------------------------

const octoberCells: CalendarDayCell[] = [
  day(27, false),
  day(28, false),
  day(29, false),
  day(30, false),
  day(1, true),
  day(2, true),
  day(3, true),

  day(4, true),
  day(5, true),
  day(6, true),
  day(7, true),
  day(8, true),
  day(9, true),
  day(10, true),

  day(11, true),
  day(12, true),
  day(13, true),
  day(14, true),
  day(15, true),
  day(16, true),
  day(17, true),

  day(18, true),
  day(19, true),
  day(20, true),
  day(21, true),
  day(22, true),
  day(23, true),
  day(24, true),

  day(25, true),
  day(26, true),
  day(27, true),
  day(28, true),
  day(29, true),
  day(30, true),
  day(31, true)
]

const october2026: CalendarMonthData = {
  monthLabel: 'October 2026',
  monthlyStats: { result: 0, tradedDays: 0 },
  weeks: chunk7(octoberCells),
  weeklySummaries: [
    { label: 'Week 1', outcome: 'no-trade', result: 0, tradedDays: 0 },
    { label: 'Week 2', outcome: 'no-trade', result: 0, tradedDays: 0 },
    { label: 'Week 3', outcome: 'no-trade', result: 0, tradedDays: 0 },
    { label: 'Week 4', outcome: 'no-trade', result: 0, tradedDays: 0 },
    { label: 'Week 5', outcome: 'no-trade', result: 0, tradedDays: 0 }
  ]
}

// Ordered so month navigation is a simple index walk. September is the
// "current" dummy month ("This month" always returns to this index).
export const calendarMonths: CalendarMonthData[] = [august2026, september2026, october2026]
export const currentMonthIndex = 1
