// Static shapes for the Checkpoint 007 Journal workspace's dummy data only.
// Not a domain model — the real Trading Domain / Normalization Layer types
// (Order, Execution, Source Position, Trade — see docs/TRADE_MODEL_CONCEPTS.md)
// land in a later checkpoint. Every value here is an already-computed visual
// fixture; nothing is derived from raw broker data, and no broker-specific
// field (Tradovate/MT5) is represented, per docs/JOURNAL_SPEC.md §7.

export type Direction = 'Long' | 'Short'
export type ExecutionSide = 'BUY' | 'SELL'
export type Outcome = 'positive' | 'negative' | 'break-even'
// UNREVIEWED = not yet evaluated (default); distinct from N/A = explicitly
// judged not applicable. See docs/STRATEGY_BUILDER_SPEC.md §9.
export type RuleState = 'Pass' | 'Fail' | 'N/A' | 'Unreviewed'

export interface JournalExecution {
  id: string
  time: string
  side: ExecutionSide
  qty: number
  price: number
  fee: number
}

export interface StrategyRule {
  name: string
  state: RuleState
}

export interface JournalTrade {
  id: string
  date: string
  account: string
  instrument: string
  direction: Direction
  executions: JournalExecution[]

  openTime: string
  closeTime: string
  duration: string

  avgEntry: number
  avgExit: number
  qty: number

  grossPnl: number
  fees: number
  netPnl: number
  outcome: Outcome

  plannedR: number | null
  realizedR: number | null

  strategy: string
  strategyVersion: string
  complianceRules: StrategyRule[]

  tradeNote: string
  dayNote?: string
}
