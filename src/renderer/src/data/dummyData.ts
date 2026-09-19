import type { ChecklistRule, DayPerformance, EquityPoint } from '@renderer/types/dummy'

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

