// Static dummy Trade fixtures for the Checkpoint 007 Journal workspace.
// These are pre-computed visual fixtures only — see types/journal.ts. They
// intentionally exercise: a simple long, a simple short, a scale-in +
// partial-exit long, a scale-out partial-exit short, and a break-even trade,
// so the UI can prove TRADE != EXECUTION and that direction is never read
// off the closing execution's side (docs/TRADE_MODEL_CONCEPTS.md §5).

import type { JournalTrade } from '@renderer/types/journal'

export const journalTrades: JournalTrade[] = [
  // TRADE A — simple long, one entry, one exit, positive.
  {
    id: 'trade-a',
    date: 'Sep 12',
    account: 'Apex 50K',
    instrument: 'NQ',
    direction: 'Long',
    executions: [
      { id: 'a1', time: '09:15:22', side: 'BUY', qty: 1, price: 19820.0, fee: 2.5 },
      { id: 'a2', time: '09:38:10', side: 'SELL', qty: 1, price: 19846.5, fee: 2.5 }
    ],
    openTime: '09:15:22',
    closeTime: '09:38:10',
    duration: '22m 48s',
    avgEntry: 19820.0,
    avgExit: 19846.5,
    qty: 1,
    grossPnl: 530.0,
    fees: 5.0,
    netPnl: 525.0,
    outcome: 'positive',
    plannedR: 2.0,
    realizedR: 2.1,
    strategy: 'Strategy Alpha',
    strategyVersion: 'v3',
    compliance: 'Compliant',
    complianceRules: [
      { name: 'Rule A', state: 'Pass' },
      { name: 'Rule B', state: 'Pass' },
      { name: 'Rule C', state: 'Pass' },
      { name: 'Rule D', state: 'Pass' },
      { name: 'Rule E', state: 'N/A' }
    ],
    tradeNote: 'Clean entry on plan, took the full target without hesitation.',
    dayNote: 'Slow open, waited for the first real setup instead of forcing size.'
  },

  // TRADE B — simple short, one SELL entry, one BUY exit, negative. The
  // final execution is a BUY — it must never read as a long trade.
  {
    id: 'trade-b',
    date: 'Sep 12',
    account: 'Apex 50K',
    instrument: 'ES',
    direction: 'Short',
    executions: [
      { id: 'b1', time: '10:05:11', side: 'SELL', qty: 1, price: 5652.0, fee: 2.25 },
      { id: 'b2', time: '10:11:47', side: 'BUY', qty: 1, price: 5659.5, fee: 2.25 }
    ],
    openTime: '10:05:11',
    closeTime: '10:11:47',
    duration: '6m 36s',
    avgEntry: 5652.0,
    avgExit: 5659.5,
    qty: 1,
    grossPnl: -375.0,
    fees: 4.5,
    netPnl: -379.5,
    outcome: 'negative',
    plannedR: 2.0,
    realizedR: -1.1,
    strategy: 'Strategy Alpha',
    strategyVersion: 'v3',
    compliance: 'Violation',
    complianceRules: [
      { name: 'Rule A', state: 'Pass' },
      { name: 'Rule B', state: 'Fail' },
      { name: 'Rule C', state: 'Pass' },
      { name: 'Rule D', state: 'Pass' },
      { name: 'Rule E', state: 'N/A' }
    ],
    tradeNote: 'Chased the entry after the level had already reacted — size was fine, timing was not.'
  },

  // TRADE C — scale-in + partial exits. Two BUY entries, two SELL exits.
  // Must render as ONE trade, never four.
  {
    id: 'trade-c',
    date: 'Sep 15',
    account: 'Apex 50K',
    instrument: 'NQ',
    direction: 'Long',
    executions: [
      { id: 'c1', time: '09:41:13', side: 'BUY', qty: 1, price: 19842.0, fee: 2.5 },
      { id: 'c2', time: '09:42:08', side: 'BUY', qty: 1, price: 19846.0, fee: 2.5 },
      { id: 'c3', time: '09:51:27', side: 'SELL', qty: 1, price: 19870.0, fee: 2.5 },
      { id: 'c4', time: '09:56:44', side: 'SELL', qty: 1, price: 19900.0, fee: 2.5 }
    ],
    openTime: '09:41:13',
    closeTime: '09:56:44',
    duration: '15m 31s',
    avgEntry: 19844.0,
    avgExit: 19885.0,
    qty: 2,
    grossPnl: 1640.0,
    fees: 10.0,
    netPnl: 1630.0,
    outcome: 'positive',
    plannedR: 1.5,
    realizedR: 2.4,
    strategy: 'Strategy Alpha',
    strategyVersion: 'v3',
    compliance: 'Partial',
    complianceRules: [
      { name: 'Rule A', state: 'Pass' },
      { name: 'Rule B', state: 'Pass' },
      { name: 'Rule C', state: 'Fail' },
      { name: 'Rule D', state: 'Pass' },
      { name: 'Rule E', state: 'N/A' }
    ],
    tradeNote: 'Scaled in on the retest, then trimmed into the first extension before letting the rest run.',
    dayNote: 'Slow open, waited for the first real setup instead of forcing size.'
  },

  // TRADE D — short with a scale-out entry and two partial exits. Must
  // still render as ONE trade.
  {
    id: 'trade-d',
    date: 'Sep 15',
    account: 'Apex 50K',
    instrument: 'MNQ',
    direction: 'Short',
    executions: [
      { id: 'd1', time: '13:02:05', side: 'SELL', qty: 2, price: 19910.0, fee: 4.0 },
      { id: 'd2', time: '13:07:40', side: 'BUY', qty: 1, price: 19898.0, fee: 2.0 },
      { id: 'd3', time: '13:14:52', side: 'BUY', qty: 1, price: 19884.0, fee: 2.0 }
    ],
    openTime: '13:02:05',
    closeTime: '13:14:52',
    duration: '12m 47s',
    avgEntry: 19910.0,
    avgExit: 19891.0,
    qty: 2,
    grossPnl: 380.0,
    fees: 8.0,
    netPnl: 372.0,
    outcome: 'positive',
    plannedR: 1.0,
    realizedR: 1.6,
    strategy: 'Strategy Beta',
    strategyVersion: 'v1',
    compliance: 'Compliant',
    complianceRules: [
      { name: 'Rule A', state: 'Pass' },
      { name: 'Rule B', state: 'Pass' },
      { name: 'Rule C', state: 'N/A' },
      { name: 'Rule D', state: 'Pass' },
      { name: 'Rule E', state: 'Pass' }
    ],
    tradeNote: 'Covered half into the first support reaction, let the rest work to the planned level.'
  },

  // TRADE E — break-even.
  {
    id: 'trade-e',
    date: 'Sep 16',
    account: 'Apex 50K',
    instrument: 'MES',
    direction: 'Long',
    executions: [
      { id: 'e1', time: '14:20:00', side: 'BUY', qty: 1, price: 5648.0, fee: 1.25 },
      { id: 'e2', time: '14:33:12', side: 'SELL', qty: 1, price: 5648.0, fee: 1.25 }
    ],
    openTime: '14:20:00',
    closeTime: '14:33:12',
    duration: '13m 12s',
    avgEntry: 5648.0,
    avgExit: 5648.0,
    qty: 1,
    grossPnl: 0,
    fees: 2.5,
    netPnl: -2.5,
    outcome: 'break-even',
    plannedR: 1.0,
    realizedR: 0,
    strategy: 'Strategy Beta',
    strategyVersion: 'v1',
    compliance: 'Compliant',
    complianceRules: [
      { name: 'Rule A', state: 'Pass' },
      { name: 'Rule B', state: 'Pass' },
      { name: 'Rule C', state: 'Pass' },
      { name: 'Rule D', state: 'N/A' },
      { name: 'Rule E', state: 'Pass' }
    ],
    tradeNote: 'Stopped at breakeven once the setup failed to follow through — no harm, no foul.'
  }
]
