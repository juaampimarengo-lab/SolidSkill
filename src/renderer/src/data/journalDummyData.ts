// Canonical static Trade fixtures — the single shared trade universe for
// Dashboard (Recent Trades, Calendar Preview), Calendar Workspace, Day
// Review, Journal, and canonical Trade Review (Checkpoint 008). Every other
// surface derives its data from this array; none of them maintain an
// independent trade universe.
//
// `date` is the shared lookup key ("Sep 15") every other fixture module
// groups by — it must stay in this exact "<Mon> <D>" format, no leading
// zero, matching the format calendarDummyData.ts generates for day cells.
//
// The review "today" is September 16, 2026 — no trade here is dated after
// that, so no calendar cell can show realized activity for a date that
// hasn't occurred yet (see CLAUDE.md checkpoint instructions,
// "FIX THE FUTURE-DATE DUMMY-DATA ISSUE").
//
// Trades A-E (Checkpoint 007) are unchanged and remain the golden
// LONG/SHORT + multi-execution integrity examples: TRADE != EXECUTION, and
// direction is never read off the closing execution's side (see
// docs/TRADE_MODEL_CONCEPTS.md §5).

import type { JournalTrade } from '@renderer/types/journal'

export const journalTrades: JournalTrade[] = [
  // AUG 3 — simple long, positive.
  {
    id: 'aug3-1',
    date: 'Aug 3',
    account: 'Apex 50K',
    instrument: 'NQ',
    direction: 'Long',
    executions: [
      { id: 'aug3-1-e1', time: '09:18:40', side: 'BUY', qty: 1, price: 19500.0, fee: 2.5 },
      { id: 'aug3-1-e2', time: '09:44:12', side: 'SELL', qty: 1, price: 19540.0, fee: 2.5 }
    ],
    openTime: '09:18:40',
    closeTime: '09:44:12',
    duration: '25m 32s',
    avgEntry: 19500.0,
    avgExit: 19540.0,
    qty: 1,
    grossPnl: 800.0,
    fees: 5.0,
    netPnl: 795.0,
    outcome: 'positive',
    plannedR: 2.0,
    realizedR: 2.0,
    strategy: 'Strategy Alpha',
    strategyVersion: 'v2',
    compliance: 'Compliant',
    complianceRules: [
      { name: 'Rule A', state: 'Pass' },
      { name: 'Rule B', state: 'Pass' },
      { name: 'Rule C', state: 'Pass' },
      { name: 'Rule D', state: 'N/A' },
      { name: 'Rule E', state: 'Pass' }
    ],
    tradeNote: 'Textbook entry on the reclaim, held for the full planned target.'
  },

  // AUG 12 — short, negative, journal entry day.
  {
    id: 'aug12-1',
    date: 'Aug 12',
    account: 'Apex 50K',
    instrument: 'ES',
    direction: 'Short',
    executions: [
      { id: 'aug12-1-e1', time: '13:10:02', side: 'SELL', qty: 1, price: 5560.0, fee: 2.25 },
      { id: 'aug12-1-e2', time: '13:24:55', side: 'BUY', qty: 1, price: 5572.0, fee: 2.25 }
    ],
    openTime: '13:10:02',
    closeTime: '13:24:55',
    duration: '14m 53s',
    avgEntry: 5560.0,
    avgExit: 5572.0,
    qty: 1,
    grossPnl: -600.0,
    fees: 4.5,
    netPnl: -604.5,
    outcome: 'negative',
    plannedR: 1.5,
    realizedR: -1.3,
    strategy: 'Strategy Beta',
    strategyVersion: 'v1',
    compliance: 'Violation',
    complianceRules: [
      { name: 'Rule A', state: 'Fail' },
      { name: 'Rule B', state: 'Pass' },
      { name: 'Rule C', state: 'N/A' },
      { name: 'Rule D', state: 'Pass' },
      { name: 'Rule E', state: 'Pass' }
    ],
    tradeNote: 'Forced a trade out of boredom mid-session — exactly the kind of setup I should skip.',
    dayNote: 'Forced a trade out of boredom mid-session — exactly the kind of setup I should skip.'
  },

  // AUG 27 — scale-in long, positive, journal entry day.
  {
    id: 'aug27-1',
    date: 'Aug 27',
    account: 'Apex 50K',
    instrument: 'MNQ',
    direction: 'Long',
    executions: [
      { id: 'aug27-1-e1', time: '10:02:18', side: 'BUY', qty: 1, price: 19450.0, fee: 2.0 },
      { id: 'aug27-1-e2', time: '10:04:47', side: 'BUY', qty: 1, price: 19458.0, fee: 2.0 },
      { id: 'aug27-1-e3', time: '10:31:09', side: 'SELL', qty: 2, price: 19498.0, fee: 4.0 }
    ],
    openTime: '10:02:18',
    closeTime: '10:31:09',
    duration: '28m 51s',
    avgEntry: 19454.0,
    avgExit: 19498.0,
    qty: 2,
    grossPnl: 1600.0,
    fees: 8.0,
    netPnl: 1592.0,
    outcome: 'positive',
    plannedR: 2.0,
    realizedR: 2.5,
    strategy: 'Strategy Alpha',
    strategyVersion: 'v2',
    compliance: 'Compliant',
    complianceRules: [
      { name: 'Rule A', state: 'Pass' },
      { name: 'Rule B', state: 'Pass' },
      { name: 'Rule C', state: 'Pass' },
      { name: 'Rule D', state: 'N/A' },
      { name: 'Rule E', state: 'Pass' }
    ],
    tradeNote: 'Best trade of the month — patient entry, added size on confirmation, held to target.',
    dayNote: 'Best trade of the month — patient entry, full size, held to target.'
  },

  // SEP 1 — two trades, one win one loss.
  {
    id: 'sep1-1',
    date: 'Sep 1',
    account: 'Apex 50K',
    instrument: 'NQ',
    direction: 'Long',
    executions: [
      { id: 'sep1-1-e1', time: '09:20:05', side: 'BUY', qty: 1, price: 19700.0, fee: 2.5 },
      { id: 'sep1-1-e2', time: '09:35:40', side: 'SELL', qty: 1, price: 19725.0, fee: 2.5 }
    ],
    openTime: '09:20:05',
    closeTime: '09:35:40',
    duration: '15m 35s',
    avgEntry: 19700.0,
    avgExit: 19725.0,
    qty: 1,
    grossPnl: 500.0,
    fees: 5.0,
    netPnl: 495.0,
    outcome: 'positive',
    plannedR: 1.5,
    realizedR: 1.6,
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
    tradeNote: 'First pullback of the day, took it per plan.'
  },
  {
    id: 'sep1-2',
    date: 'Sep 1',
    account: 'Apex 50K',
    instrument: 'ES',
    direction: 'Short',
    executions: [
      { id: 'sep1-2-e1', time: '10:10:20', side: 'SELL', qty: 1, price: 5610.0, fee: 2.25 },
      { id: 'sep1-2-e2', time: '10:18:47', side: 'BUY', qty: 1, price: 5616.0, fee: 2.25 }
    ],
    openTime: '10:10:20',
    closeTime: '10:18:47',
    duration: '8m 27s',
    avgEntry: 5610.0,
    avgExit: 5616.0,
    qty: 1,
    grossPnl: -300.0,
    fees: 4.5,
    netPnl: -304.5,
    outcome: 'negative',
    plannedR: 1.5,
    realizedR: -0.9,
    strategy: 'Strategy Alpha',
    strategyVersion: 'v3',
    compliance: 'Partial',
    complianceRules: [
      { name: 'Rule A', state: 'Pass' },
      { name: 'Rule B', state: 'Fail' },
      { name: 'Rule C', state: 'Pass' },
      { name: 'Rule D', state: 'Pass' },
      { name: 'Rule E', state: 'N/A' }
    ],
    tradeNote: 'Re-entered too soon after the first winner — gave part of it back.'
  },

  // SEP 2 — single loss.
  {
    id: 'sep2-1',
    date: 'Sep 2',
    account: 'Apex 50K',
    instrument: 'MNQ',
    direction: 'Long',
    executions: [
      { id: 'sep2-1-e1', time: '09:05:11', side: 'BUY', qty: 2, price: 19730.0, fee: 4.0 },
      { id: 'sep2-1-e2', time: '09:20:36', side: 'SELL', qty: 2, price: 19715.0, fee: 4.0 }
    ],
    openTime: '09:05:11',
    closeTime: '09:20:36',
    duration: '15m 25s',
    avgEntry: 19730.0,
    avgExit: 19715.0,
    qty: 2,
    grossPnl: -300.0,
    fees: 8.0,
    netPnl: -308.0,
    outcome: 'negative',
    plannedR: 1.0,
    realizedR: -1.0,
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
    tradeNote: 'Stop hit clean at planned level, no adjustment needed — process was fine, market just went the other way.'
  },

  // SEP 4 — two break-even trades.
  {
    id: 'sep4-1',
    date: 'Sep 4',
    account: 'Apex 50K',
    instrument: 'NQ',
    direction: 'Long',
    executions: [
      { id: 'sep4-1-e1', time: '09:12:00', side: 'BUY', qty: 1, price: 19750.0, fee: 2.5 },
      { id: 'sep4-1-e2', time: '09:19:44', side: 'SELL', qty: 1, price: 19750.0, fee: 2.5 }
    ],
    openTime: '09:12:00',
    closeTime: '09:19:44',
    duration: '7m 44s',
    avgEntry: 19750.0,
    avgExit: 19750.0,
    qty: 1,
    grossPnl: 0,
    fees: 5.0,
    netPnl: -5.0,
    outcome: 'break-even',
    plannedR: 1.5,
    realizedR: 0,
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
    tradeNote: 'Scratched at breakeven once momentum stalled.',
    dayNote: 'Choppy session, both attempts scratched at breakeven rather than forced — good discipline.'
  },
  {
    id: 'sep4-2',
    date: 'Sep 4',
    account: 'Apex 50K',
    instrument: 'ES',
    direction: 'Short',
    executions: [
      { id: 'sep4-2-e1', time: '11:02:15', side: 'SELL', qty: 1, price: 5620.0, fee: 2.25 },
      { id: 'sep4-2-e2', time: '11:09:03', side: 'BUY', qty: 1, price: 5620.0, fee: 2.25 }
    ],
    openTime: '11:02:15',
    closeTime: '11:09:03',
    duration: '6m 48s',
    avgEntry: 5620.0,
    avgExit: 5620.0,
    qty: 1,
    grossPnl: 0,
    fees: 4.5,
    netPnl: -4.5,
    outcome: 'break-even',
    plannedR: 1.5,
    realizedR: 0,
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
    tradeNote: 'Same story, second attempt — flat market, scratched instead of forcing.',
    dayNote: 'Choppy session, both attempts scratched at breakeven rather than forced — good discipline.'
  },

  // SEP 8 — single loss, violation.
  {
    id: 'sep8-1',
    date: 'Sep 8',
    account: 'Apex 50K',
    instrument: 'NQ',
    direction: 'Short',
    executions: [
      { id: 'sep8-1-e1', time: '11:00:04', side: 'SELL', qty: 1, price: 19800.0, fee: 2.5 },
      { id: 'sep8-1-e2', time: '11:20:31', side: 'BUY', qty: 1, price: 19824.0, fee: 2.5 }
    ],
    openTime: '11:00:04',
    closeTime: '11:20:31',
    duration: '20m 27s',
    avgEntry: 19800.0,
    avgExit: 19824.0,
    qty: 1,
    grossPnl: -480.0,
    fees: 5.0,
    netPnl: -485.0,
    outcome: 'negative',
    plannedR: 1.5,
    realizedR: -1.2,
    strategy: 'Strategy Beta',
    strategyVersion: 'v1',
    compliance: 'Violation',
    complianceRules: [
      { name: 'Rule A', state: 'Fail' },
      { name: 'Rule B', state: 'Pass' },
      { name: 'Rule C', state: 'N/A' },
      { name: 'Rule D', state: 'Fail' },
      { name: 'Rule E', state: 'Pass' }
    ],
    tradeNote: 'Entered against the higher-timeframe context — knew it while placing it.'
  },

  // SEP 10 — two wins, journal entry day.
  {
    id: 'sep10-1',
    date: 'Sep 10',
    account: 'Apex 50K',
    instrument: 'NQ',
    direction: 'Long',
    executions: [
      { id: 'sep10-1-e1', time: '09:10:02', side: 'BUY', qty: 1, price: 19600.0, fee: 2.5 },
      { id: 'sep10-1-e2', time: '09:25:18', side: 'SELL', qty: 1, price: 19640.0, fee: 2.5 }
    ],
    openTime: '09:10:02',
    closeTime: '09:25:18',
    duration: '15m 16s',
    avgEntry: 19600.0,
    avgExit: 19640.0,
    qty: 1,
    grossPnl: 800.0,
    fees: 5.0,
    netPnl: 795.0,
    outcome: 'positive',
    plannedR: 2.0,
    realizedR: 2.0,
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
    tradeNote: 'Clean trend entry, held for the full planned target.',
    dayNote: 'Strong trend day — followed the plan on both entries and let winners run.'
  },
  {
    id: 'sep10-2',
    date: 'Sep 10',
    account: 'Apex 50K',
    instrument: 'ES',
    direction: 'Long',
    executions: [
      { id: 'sep10-2-e1', time: '10:00:40', side: 'BUY', qty: 2, price: 5580.0, fee: 4.5 },
      { id: 'sep10-2-e2', time: '10:12:55', side: 'SELL', qty: 2, price: 5588.0, fee: 4.5 }
    ],
    openTime: '10:00:40',
    closeTime: '10:12:55',
    duration: '12m 15s',
    avgEntry: 5580.0,
    avgExit: 5588.0,
    qty: 2,
    grossPnl: 800.0,
    fees: 9.0,
    netPnl: 791.0,
    outcome: 'positive',
    plannedR: 1.5,
    realizedR: 1.8,
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
    tradeNote: 'Same context as the first trade, sized up on the second confirmation.',
    dayNote: 'Strong trend day — followed the plan on both entries and let winners run.'
  },

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
    dayNote: 'Two trades, one clean winner and one avoidable loss from chasing an entry.'
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
    tradeNote: 'Chased the entry after the level had already reacted — size was fine, timing was not.',
    dayNote: 'Two trades, one clean winner and one avoidable loss from chasing an entry.'
  },

  // SEP 14 — single win, journal entry day.
  {
    id: 'sep14-1',
    date: 'Sep 14',
    account: 'Apex 50K',
    instrument: 'MNQ',
    direction: 'Long',
    executions: [
      { id: 'sep14-1-e1', time: '09:30:10', side: 'BUY', qty: 3, price: 19680.0, fee: 6.0 },
      { id: 'sep14-1-e2', time: '09:50:42', side: 'SELL', qty: 3, price: 19700.0, fee: 6.0 }
    ],
    openTime: '09:30:10',
    closeTime: '09:50:42',
    duration: '20m 32s',
    avgEntry: 19680.0,
    avgExit: 19700.0,
    qty: 3,
    grossPnl: 600.0,
    fees: 12.0,
    netPnl: 588.0,
    outcome: 'positive',
    plannedR: 1.5,
    realizedR: 1.4,
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
    tradeNote: 'Only one clean setup all day, sized normally and let it play out.',
    dayNote: 'Slower session, only one clean setup all day.'
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
    tradeNote: 'Covered half into the first support reaction, let the rest work to the planned level.',
    dayNote: 'Slow open, waited for the first real setup instead of forcing size.'
  },

  // TRADE E — break-even. Today (Sep 16, 2026) — the review date.
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
