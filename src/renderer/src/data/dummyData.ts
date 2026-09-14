import type { CalendarDay, ChecklistRule, DayPerformance, EquityPoint, RecentTrade } from '@renderer/types/dummy'

export const recentTrades: RecentTrade[] = [
  {
    time: '09:42',
    instrument: 'NQ',
    side: 'Long',
    qty: 2,
    entry: 19842.5,
    exit: 19878.25,
    resultUsd: 715.0,
    outcome: 'positive',
    r: 1.8,
    strategy: 'Strategy A',
    compliance: 'Compliant'
  },
  {
    time: '10:17',
    instrument: 'ES',
    side: 'Short',
    qty: 1,
    entry: 5642.0,
    exit: 5649.5,
    resultUsd: -375.0,
    outcome: 'negative',
    r: -1.0,
    strategy: 'Strategy A',
    compliance: 'Violation'
  },
  {
    time: '11:08',
    instrument: 'MNQ',
    side: 'Long',
    qty: 4,
    entry: 19851.0,
    exit: 19851.0,
    resultUsd: 0,
    outcome: 'break-even',
    r: 0,
    strategy: 'Strategy B',
    compliance: 'Compliant'
  },
  {
    time: '12:34',
    instrument: 'ES',
    side: 'Long',
    qty: 2,
    entry: 5638.25,
    exit: 5646.75,
    resultUsd: 850.0,
    outcome: 'positive',
    r: 2.1,
    strategy: 'Strategy A',
    compliance: 'Compliant'
  },
  {
    time: '13:52',
    instrument: 'NQ',
    side: 'Short',
    qty: 1,
    entry: 19902.0,
    exit: 19918.5,
    resultUsd: -330.0,
    outcome: 'negative',
    r: -0.8,
    strategy: 'Strategy B',
    compliance: 'Partial'
  },
  {
    time: '14:15',
    instrument: 'MNQ',
    side: 'Long',
    qty: 3,
    entry: 19875.25,
    exit: 19891.0,
    resultUsd: 472.5,
    outcome: 'positive',
    r: 1.4,
    strategy: 'Strategy A',
    compliance: 'Compliant'
  }
]

export const performanceByDay: DayPerformance[] = [
  { label: 'Mon', pnl: 482.0, outcome: 'positive' },
  { label: 'Tue', pnl: -214.5, outcome: 'negative' },
  { label: 'Wed', pnl: 916.25, outcome: 'positive' },
  { label: 'Thu', pnl: 0, outcome: 'break-even' },
  { label: 'Fri', pnl: 658.75, outcome: 'positive' }
]

export const equityCurve: EquityPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 320 },
  { x: 2, y: 180 },
  { x: 3, y: 540 },
  { x: 4, y: 410 },
  { x: 5, y: 860 },
  { x: 6, y: 720 },
  { x: 7, y: 1120 },
  { x: 8, y: 980 },
  { x: 9, y: 1380 },
  { x: 10, y: 1240 },
  { x: 11, y: 1610 },
  { x: 12, y: 1842.5 }
]

export const complianceRules: ChecklistRule[] = [
  { name: 'Rule A', state: 'Pass' },
  { name: 'Rule B', state: 'Pass' },
  { name: 'Rule C', state: 'Fail' },
  { name: 'Rule D', state: 'N/A' },
  { name: 'Rule E', state: 'Pass' }
]

function buildCalendar(): CalendarDay[] {
  const leadingBlank: CalendarDay[] = Array.from({ length: 3 }, (_, i) => ({
    date: 28 + i,
    inMonth: false,
    pnl: null,
    trades: 0,
    outcome: 'none'
  }))

  const pattern: Array<Pick<CalendarDay, 'pnl' | 'trades' | 'outcome' | 'hasNote'>> = [
    { pnl: 482, trades: 4, outcome: 'positive' },
    { pnl: -214.5, trades: 3, outcome: 'negative' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: 916.25, trades: 6, outcome: 'positive', hasNote: true },
    { pnl: 0, trades: 2, outcome: 'break-even' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: 658.75, trades: 5, outcome: 'positive' },
    { pnl: -96.0, trades: 2, outcome: 'negative' },
    { pnl: 1204.0, trades: 7, outcome: 'positive', hasNote: true },
    { pnl: -488.25, trades: 4, outcome: 'negative' },
    { pnl: 220.5, trades: 3, outcome: 'positive' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: 340.0, trades: 3, outcome: 'positive' },
    { pnl: 0, trades: 1, outcome: 'break-even' },
    { pnl: -152.0, trades: 2, outcome: 'negative' },
    { pnl: 812.5, trades: 5, outcome: 'positive' },
    { pnl: 118.25, trades: 2, outcome: 'positive' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: -64.0, trades: 1, outcome: 'negative' },
    { pnl: 540.0, trades: 4, outcome: 'positive' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: 0, trades: 2, outcome: 'break-even' },
    { pnl: 1842.5, trades: 6, outcome: 'positive', hasNote: true },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: null, trades: 0, outcome: 'none' },
    { pnl: 275.5, trades: 3, outcome: 'positive' }
  ]

  const inMonth: CalendarDay[] = pattern.map((entry, i) => ({
    date: i + 1,
    inMonth: true,
    ...entry,
    isToday: i + 1 === 24
  }))

  const trailing: CalendarDay[] = Array.from({ length: 2 }, (_, i) => ({
    date: i + 1,
    inMonth: false,
    pnl: null,
    trades: 0,
    outcome: 'none'
  }))

  return [...leadingBlank, ...inMonth, ...trailing]
}

export const calendarDays: CalendarDay[] = buildCalendar()
