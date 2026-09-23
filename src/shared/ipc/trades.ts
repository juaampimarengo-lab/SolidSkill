/**
 * Trading IPC contract shared by main, preload, and renderer (Checkpoint
 * 011B-2). Application-level shapes — NOT persistence rows: no SQL
 * conventions, no BigInt, no upper-case DB enums.
 *
 * Conventions (docs/IPC_CONTRACT.md):
 *  - Money, prices, quantities and R values are canonical DECIMAL STRINGS
 *    ("-1234.5"), exactly as stored. They are never JS numbers on the wire.
 *  - `null` means "not reported / not applicable", never an invented zero.
 *  - Timestamps are epoch milliseconds (UTC). The analytical trading date is a
 *    separate 'YYYY-MM-DD' fact and is the ONLY grouping key for days;
 *    it is never derived from a timestamp in the renderer.
 *  - Direction is an explicit persisted fact, never derived from executions.
 *  - Strategy association is by persisted ids (strategy + exact version).
 *    Every name is USER DATA.
 */

import type { ComplianceCounts } from '../compliance'
import type { IpcResult } from './result'

export type Decimal = string
export type DirectionDto = 'Long' | 'Short'
export type ExecutionSideDto = 'BUY' | 'SELL'
export type RuleStateDto = 'Pass' | 'Fail' | 'N/A' | 'Unreviewed'
export const RULE_STATES: readonly RuleStateDto[] = ['Pass', 'Fail', 'N/A', 'Unreviewed']

export interface AccountDto {
  id: string
  displayName: string
  currency: string
  /** IANA zone used to present this account's timestamps; null = unknown (shown as UTC). */
  timezone: string | null
}

/** The exact Strategy + published Version a Trade was evaluated against. */
export interface TradeStrategyDto {
  strategyId: string
  /** The Strategy's CURRENT name (renaming never detaches trades). */
  strategyName: string
  versionId: string
  versionNumber: number
}

/** List-row model: everything the table/calendar/dashboard surfaces need, no executions. */
export interface TradeSummaryDto {
  id: string
  accountId: string
  accountName: string
  /** Account timezone, for presenting the timestamps below. */
  timezone: string | null
  /** Analytical trading date, 'YYYY-MM-DD'. */
  tradeDate: string
  instrument: string
  direction: DirectionDto
  quantity: Decimal
  openedAt: number
  closedAt: number | null
  avgEntry: Decimal
  avgExit: Decimal | null
  grossPnl: Decimal | null
  commission: Decimal | null
  fees: Decimal | null
  swap: Decimal | null
  netPnl: Decimal | null
  plannedR: Decimal | null
  realizedR: Decimal | null
  strategy: TradeStrategyDto | null
  /** Rule-state counts of the evaluated version; all zero when there is no strategy. */
  compliance: ComplianceCounts
}

export interface ExecutionDto {
  id: string
  executedAt: number
  side: ExecutionSideDto
  quantity: Decimal
  price: Decimal
  commission: Decimal | null
  fees: Decimal | null
  swap: Decimal | null
}

export interface EvaluatedRuleDto {
  ruleId: string
  name: string
  state: RuleStateDto
}

export interface EvaluatedGroupDto {
  groupId: string
  name: string
  rules: EvaluatedRuleDto[]
}

/** The saved version at time of evaluation, with the trade's rule results. */
export interface TradeStrategyDetailDto extends TradeStrategyDto {
  /** Epoch ms the version was published. */
  publishedAt: number
  groups: EvaluatedGroupDto[]
}

export interface TradeDetailDto {
  trade: TradeSummaryDto
  /** Chronological. One Trade may own any number of executions. */
  executions: ExecutionDto[]
  strategy: TradeStrategyDetailDto | null
  /** '' when no note has been written. */
  tradeNote: string
  /** The Day Note of (account, analytical date); '' when none. */
  dayNote: string
  /** All trades of the same account and analytical date, chronological (includes this one). */
  siblings: TradeSummaryDto[]
}

export interface DayDto {
  accountId: string
  accountName: string
  timezone: string | null
  date: string
  trades: TradeSummaryDto[]
  dayNote: string
}

export interface TradeListDto {
  accounts: AccountDto[]
  /** Chronological: analytical date, then open time. */
  trades: TradeSummaryDto[]
  /** (account, date) pairs that have a non-empty Day Note — for the Calendar marker. */
  daysWithNotes: { accountId: string; date: string }[]
}

export interface TradeListRequest {
  accountId?: string
  /** Inclusive analytical-date bounds, 'YYYY-MM-DD'. Reserved seam for date filtering. */
  fromDate?: string
  toDate?: string
}

export interface RuleEvaluationResultDto {
  tradeId: string
  ruleId: string
  state: RuleStateDto
  compliance: ComplianceCounts
}

/**
 * Pushed from main after automatic MT5 reconciliation persists new Trades
 * (Checkpoint 012B-4). Carries only the Solid Skill account id: no MT5 login,
 * server, deal tickets, or other raw source identity ever crosses this
 * boundary. Not a request/response call — see `TradesApi.onDataChanged`.
 */
export interface TradingDataChangedDto {
  accountId: string
  reason: 'mt5-reconciliation'
}

/** The Trading operations the renderer may call. Nothing here touches a broker. */
export interface TradesApi {
  list(request?: TradeListRequest): Promise<IpcResult<TradeListDto>>
  getDetail(tradeId: string): Promise<IpcResult<TradeDetailDto>>
  getDay(request: { accountId: string; date: string }): Promise<IpcResult<DayDto>>
  updateTradeNote(request: { tradeId: string; body: string }): Promise<IpcResult<{ tradeId: string; body: string }>>
  updateDayNote(request: {
    accountId: string
    date: string
    body: string
  }): Promise<IpcResult<{ accountId: string; date: string; body: string }>>
  /** Only rules of the trade's own strategy version can be judged. */
  updateRuleEvaluation(request: {
    tradeId: string
    ruleId: string
    state: RuleStateDto
  }): Promise<IpcResult<RuleEvaluationResultDto>>
  /**
   * One-time V1 assignment of an EXACT published Strategy Version to a Trade
   * that has none. Atomically sets the association and creates one UNREVIEWED
   * evaluation per rule of that version. Refused for a Trade that already has
   * a version (no reassignment in V1), for a Draft, and for any id that is not
   * a published version id (a Strategy id alone is not enough). Changes no
   * Trade fact (direction, prices, P&L, costs, executions, notes, media).
   * Returns the Trade's refreshed detail.
   */
  assignStrategyVersion(request: { tradeId: string; strategyVersionId: string }): Promise<IpcResult<TradeDetailDto>>
  /**
   * Subscribes to `TradingDataChangedDto` pushes (e.g. automatic MT5
   * reconciliation). Returns an unsubscribe function. Not a request/response
   * call, and not one of `TRADE_CHANNELS` (main never `ipcMain.handle`s it).
   */
  onDataChanged(listener: (event: TradingDataChangedDto) => void): () => void
}

export const TRADE_CHANNELS = {
  list: 'trades:list',
  getDetail: 'trades:getDetail',
  getDay: 'trades:getDay',
  updateTradeNote: 'trades:updateTradeNote',
  updateDayNote: 'trades:updateDayNote',
  updateRuleEvaluation: 'trades:updateRuleEvaluation',
  assignStrategyVersion: 'trades:assignStrategyVersion'
} as const

/** Push-only channel (main -> renderer). Deliberately not part of `TRADE_CHANNELS`: never `ipcMain.handle`d. */
export const TRADE_DATA_CHANGED_CHANNEL = 'trades:dataChanged'

export type TradeChannel = (typeof TRADE_CHANNELS)[keyof typeof TRADE_CHANNELS]
