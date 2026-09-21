/**
 * DEVELOPMENT-ONLY trading fixtures (Checkpoint 011B-2): the 17-trade visual-QA
 * universe that used to live in the renderer, now expressed as seed DATA for
 * the development seed (devSeed.ts). Never imported by production code paths.
 *
 * Everything here is normalized facts as if handed over by an integration:
 * explicit Trade.direction, exact decimal strings, wall-clock execution times
 * (interpreted in DEV_ACCOUNT.timezone by the seed), and rule results keyed by
 * rule NAME only because the seed needs to find the rule rows of the exact
 * published version it is associating. Runtime code never matches by name.
 *
 * Costs: the fixture's single per-execution "fee" is stored as a signed
 * commission (negative); fees and swap are unreported (NULL), not zero.
 *
 * Trades A-E (ids trade-a .. trade-e) are the golden LONG/SHORT and
 * multi-execution examples: BUY,BUY,SELL,SELL is ONE Trade with FOUR
 * executions; SELL-entry / BUY-exit is a SHORT and stays SHORT.
 * No trade is dated after 2026-09-16.
 */

export type SeedRuleState = 'Pass' | 'Fail' | 'N/A' | 'Unreviewed'

export interface SeedExecution {
  /** Wall-clock HH:MM:SS in the dev account's timezone. */
  time: string
  side: 'BUY' | 'SELL'
  quantity: string
  price: string
  commission: string
}

export interface SeedTrade {
  /** Stable fixture key; becomes source_trade_id as 'dev-fixture:<key>'. */
  key: string
  /** Analytical trading date, YYYY-MM-DD. */
  date: string
  instrument: string
  direction: 'LONG' | 'SHORT'
  quantity: string
  avgEntry: string
  avgExit: string
  gross: string
  commission: string
  net: string
  plannedR: string
  realizedR: string
  /** Seed-time lookup only: name of a seeded Strategy. */
  strategy: string
  /** Published version number of that strategy. */
  version: number
  rules: Record<string, SeedRuleState>
  tradeNote: string
  executions: SeedExecution[]
}

export const SEED_TRADES: SeedTrade[] = [
  {
    key: "aug3-1",
    date: "2026-08-03",
    instrument: "NQ",
    direction: "LONG",
    quantity: "1",
    avgEntry: "19500",
    avgExit: "19540",
    gross: "800",
    commission: "-5",
    net: "795",
    plannedR: "2",
    realizedR: "2",
    strategy: "Strategy Alpha",
    version: 2,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "N/A" },
    tradeNote: "Textbook entry on the reclaim, held for the full planned target.",
    executions: [
      { time: "09:18:40", side: "BUY", quantity: "1", price: "19500", commission: "-2.5" },
      { time: "09:44:12", side: "SELL", quantity: "1", price: "19540", commission: "-2.5" }
    ]
  },
  {
    key: "aug12-1",
    date: "2026-08-12",
    instrument: "ES",
    direction: "SHORT",
    quantity: "1",
    avgEntry: "5560",
    avgExit: "5572",
    gross: "-600",
    commission: "-4.5",
    net: "-604.5",
    plannedR: "1.5",
    realizedR: "-1.3",
    strategy: "Strategy Beta",
    version: 1,
    rules: { "Rule A": "Fail", "Rule B": "Pass", "Rule C": "N/A", "Rule D": "Pass", "Rule E": "Pass" },
    tradeNote: "Forced a trade out of boredom mid-session — exactly the kind of setup I should skip.",
    executions: [
      { time: "13:10:02", side: "SELL", quantity: "1", price: "5560", commission: "-2.25" },
      { time: "13:24:55", side: "BUY", quantity: "1", price: "5572", commission: "-2.25" }
    ]
  },
  {
    key: "aug27-1",
    date: "2026-08-27",
    instrument: "MNQ",
    direction: "LONG",
    quantity: "2",
    avgEntry: "19454",
    avgExit: "19498",
    gross: "1600",
    commission: "-8",
    net: "1592",
    plannedR: "2",
    realizedR: "2.5",
    strategy: "Strategy Alpha",
    version: 2,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "N/A" },
    tradeNote: "Best trade of the month — patient entry, added size on confirmation, held to target.",
    executions: [
      { time: "10:02:18", side: "BUY", quantity: "1", price: "19450", commission: "-2" },
      { time: "10:04:47", side: "BUY", quantity: "1", price: "19458", commission: "-2" },
      { time: "10:31:09", side: "SELL", quantity: "2", price: "19498", commission: "-4" }
    ]
  },
  {
    key: "sep1-1",
    date: "2026-09-01",
    instrument: "NQ",
    direction: "LONG",
    quantity: "1",
    avgEntry: "19700",
    avgExit: "19725",
    gross: "500",
    commission: "-5",
    net: "495",
    plannedR: "1.5",
    realizedR: "1.6",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "Pass", "Rule E": "N/A" },
    tradeNote: "First pullback of the day, took it per plan.",
    executions: [
      { time: "09:20:05", side: "BUY", quantity: "1", price: "19700", commission: "-2.5" },
      { time: "09:35:40", side: "SELL", quantity: "1", price: "19725", commission: "-2.5" }
    ]
  },
  {
    key: "sep1-2",
    date: "2026-09-01",
    instrument: "ES",
    direction: "SHORT",
    quantity: "1",
    avgEntry: "5610",
    avgExit: "5616",
    gross: "-300",
    commission: "-4.5",
    net: "-304.5",
    plannedR: "1.5",
    realizedR: "-0.9",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Fail", "Rule C": "Pass", "Rule D": "Pass", "Rule E": "N/A" },
    tradeNote: "Re-entered too soon after the first winner — gave part of it back.",
    executions: [
      { time: "10:10:20", side: "SELL", quantity: "1", price: "5610", commission: "-2.25" },
      { time: "10:18:47", side: "BUY", quantity: "1", price: "5616", commission: "-2.25" }
    ]
  },
  {
    key: "sep2-1",
    date: "2026-09-02",
    instrument: "MNQ",
    direction: "LONG",
    quantity: "2",
    avgEntry: "19730",
    avgExit: "19715",
    gross: "-300",
    commission: "-8",
    net: "-308",
    plannedR: "1",
    realizedR: "-1",
    strategy: "Strategy Beta",
    version: 1,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "N/A", "Rule D": "Pass", "Rule E": "Pass" },
    tradeNote: "Stop hit clean at planned level, no adjustment needed — process was fine, market just went the other way.",
    executions: [
      { time: "09:05:11", side: "BUY", quantity: "2", price: "19730", commission: "-4" },
      { time: "09:20:36", side: "SELL", quantity: "2", price: "19715", commission: "-4" }
    ]
  },
  {
    key: "sep4-1",
    date: "2026-09-04",
    instrument: "NQ",
    direction: "LONG",
    quantity: "1",
    avgEntry: "19750",
    avgExit: "19750",
    gross: "0",
    commission: "-5",
    net: "-5",
    plannedR: "1.5",
    realizedR: "0",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "Pass", "Rule E": "N/A" },
    tradeNote: "Scratched at breakeven once momentum stalled.",
    executions: [
      { time: "09:12:00", side: "BUY", quantity: "1", price: "19750", commission: "-2.5" },
      { time: "09:19:44", side: "SELL", quantity: "1", price: "19750", commission: "-2.5" }
    ]
  },
  {
    key: "sep4-2",
    date: "2026-09-04",
    instrument: "ES",
    direction: "SHORT",
    quantity: "1",
    avgEntry: "5620",
    avgExit: "5620",
    gross: "0",
    commission: "-4.5",
    net: "-4.5",
    plannedR: "1.5",
    realizedR: "0",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "Pass", "Rule E": "Unreviewed" },
    tradeNote: "Same story, second attempt — flat market, scratched instead of forcing.",
    executions: [
      { time: "11:02:15", side: "SELL", quantity: "1", price: "5620", commission: "-2.25" },
      { time: "11:09:03", side: "BUY", quantity: "1", price: "5620", commission: "-2.25" }
    ]
  },
  {
    key: "sep8-1",
    date: "2026-09-08",
    instrument: "NQ",
    direction: "SHORT",
    quantity: "1",
    avgEntry: "19800",
    avgExit: "19824",
    gross: "-480",
    commission: "-5",
    net: "-485",
    plannedR: "1.5",
    realizedR: "-1.2",
    strategy: "Strategy Beta",
    version: 1,
    rules: { "Rule A": "Fail", "Rule B": "Pass", "Rule C": "N/A", "Rule D": "Fail", "Rule E": "Pass" },
    tradeNote: "Entered against the higher-timeframe context — knew it while placing it.",
    executions: [
      { time: "11:00:04", side: "SELL", quantity: "1", price: "19800", commission: "-2.5" },
      { time: "11:20:31", side: "BUY", quantity: "1", price: "19824", commission: "-2.5" }
    ]
  },
  {
    key: "sep10-1",
    date: "2026-09-10",
    instrument: "NQ",
    direction: "LONG",
    quantity: "1",
    avgEntry: "19600",
    avgExit: "19640",
    gross: "800",
    commission: "-5",
    net: "795",
    plannedR: "2",
    realizedR: "2",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "Pass", "Rule E": "N/A" },
    tradeNote: "Clean trend entry, held for the full planned target.",
    executions: [
      { time: "09:10:02", side: "BUY", quantity: "1", price: "19600", commission: "-2.5" },
      { time: "09:25:18", side: "SELL", quantity: "1", price: "19640", commission: "-2.5" }
    ]
  },
  {
    key: "sep10-2",
    date: "2026-09-10",
    instrument: "ES",
    direction: "LONG",
    quantity: "2",
    avgEntry: "5580",
    avgExit: "5588",
    gross: "800",
    commission: "-9",
    net: "791",
    plannedR: "1.5",
    realizedR: "1.8",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "Pass", "Rule E": "N/A" },
    tradeNote: "Same context as the first trade, sized up on the second confirmation.",
    executions: [
      { time: "10:00:40", side: "BUY", quantity: "2", price: "5580", commission: "-4.5" },
      { time: "10:12:55", side: "SELL", quantity: "2", price: "5588", commission: "-4.5" }
    ]
  },
  {
    key: "trade-a",
    date: "2026-09-12",
    instrument: "NQ",
    direction: "LONG",
    quantity: "1",
    avgEntry: "19820",
    avgExit: "19846.5",
    gross: "530",
    commission: "-5",
    net: "525",
    plannedR: "2",
    realizedR: "2.1",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "Pass", "Rule E": "N/A" },
    tradeNote: "Clean entry on plan, took the full target without hesitation.",
    executions: [
      { time: "09:15:22", side: "BUY", quantity: "1", price: "19820", commission: "-2.5" },
      { time: "09:38:10", side: "SELL", quantity: "1", price: "19846.5", commission: "-2.5" }
    ]
  },
  {
    key: "trade-b",
    date: "2026-09-12",
    instrument: "ES",
    direction: "SHORT",
    quantity: "1",
    avgEntry: "5652",
    avgExit: "5659.5",
    gross: "-375",
    commission: "-4.5",
    net: "-379.5",
    plannedR: "2",
    realizedR: "-1.1",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Fail", "Rule C": "Pass", "Rule D": "Pass", "Rule E": "N/A" },
    tradeNote: "Chased the entry after the level had already reacted — size was fine, timing was not.",
    executions: [
      { time: "10:05:11", side: "SELL", quantity: "1", price: "5652", commission: "-2.25" },
      { time: "10:11:47", side: "BUY", quantity: "1", price: "5659.5", commission: "-2.25" }
    ]
  },
  {
    key: "sep14-1",
    date: "2026-09-14",
    instrument: "MNQ",
    direction: "LONG",
    quantity: "3",
    avgEntry: "19680",
    avgExit: "19700",
    gross: "600",
    commission: "-12",
    net: "588",
    plannedR: "1.5",
    realizedR: "1.4",
    strategy: "Strategy Beta",
    version: 1,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "N/A", "Rule D": "Pass", "Rule E": "Pass" },
    tradeNote: "Only one clean setup all day, sized normally and let it play out.",
    executions: [
      { time: "09:30:10", side: "BUY", quantity: "3", price: "19680", commission: "-6" },
      { time: "09:50:42", side: "SELL", quantity: "3", price: "19700", commission: "-6" }
    ]
  },
  {
    key: "trade-c",
    date: "2026-09-15",
    instrument: "NQ",
    direction: "LONG",
    quantity: "2",
    avgEntry: "19844",
    avgExit: "19885",
    gross: "1640",
    commission: "-10",
    net: "1630",
    plannedR: "1.5",
    realizedR: "2.4",
    strategy: "Strategy Alpha",
    version: 3,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Fail", "Rule D": "Pass", "Rule E": "N/A" },
    tradeNote: "Scaled in on the retest, then trimmed into the first extension before letting the rest run.",
    executions: [
      { time: "09:41:13", side: "BUY", quantity: "1", price: "19842", commission: "-2.5" },
      { time: "09:42:08", side: "BUY", quantity: "1", price: "19846", commission: "-2.5" },
      { time: "09:51:27", side: "SELL", quantity: "1", price: "19870", commission: "-2.5" },
      { time: "09:56:44", side: "SELL", quantity: "1", price: "19900", commission: "-2.5" }
    ]
  },
  {
    key: "trade-d",
    date: "2026-09-15",
    instrument: "MNQ",
    direction: "SHORT",
    quantity: "2",
    avgEntry: "19910",
    avgExit: "19891",
    gross: "380",
    commission: "-8",
    net: "372",
    plannedR: "1",
    realizedR: "1.6",
    strategy: "Strategy Beta",
    version: 1,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "N/A", "Rule D": "Pass", "Rule E": "Pass" },
    tradeNote: "Covered half into the first support reaction, let the rest work to the planned level.",
    executions: [
      { time: "13:02:05", side: "SELL", quantity: "2", price: "19910", commission: "-4" },
      { time: "13:07:40", side: "BUY", quantity: "1", price: "19898", commission: "-2" },
      { time: "13:14:52", side: "BUY", quantity: "1", price: "19884", commission: "-2" }
    ]
  },
  {
    key: "trade-e",
    date: "2026-09-16",
    instrument: "MES",
    direction: "LONG",
    quantity: "1",
    avgEntry: "5648",
    avgExit: "5648",
    gross: "0",
    commission: "-2.5",
    net: "-2.5",
    plannedR: "1",
    realizedR: "0",
    strategy: "Strategy Beta",
    version: 1,
    rules: { "Rule A": "Pass", "Rule B": "Pass", "Rule C": "Pass", "Rule D": "Unreviewed", "Rule E": "Pass" },
    tradeNote: "Stopped at breakeven once the setup failed to follow through — no harm, no foul.",
    executions: [
      { time: "14:20:00", side: "BUY", quantity: "1", price: "5648", commission: "-1.25" },
      { time: "14:33:12", side: "SELL", quantity: "1", price: "5648", commission: "-1.25" }
    ]
  }
]

/** Day Notes by analytical date (one per account + date). */
export const SEED_DAY_NOTES: Record<string, string> = {
  "2026-08-12": "Forced a trade out of boredom mid-session — exactly the kind of setup I should skip.",
  "2026-08-27": "Best trade of the month — patient entry, full size, held to target.",
  "2026-09-04": "Choppy session, both attempts scratched at breakeven rather than forced — good discipline.",
  "2026-09-10": "Strong trend day — followed the plan on both entries and let winners run.",
  "2026-09-12": "Two trades, one clean winner and one avoidable loss from chasing an entry.",
  "2026-09-14": "Slower session, only one clean setup all day.",
  "2026-09-15": "Slow open, waited for the first real setup instead of forcing size."
}
