import type { Decimal } from './fixedPoint'

/**
 * Persistence-layer record types. These are plain data: financial values are
 * Decimal strings (see fixedPoint.ts), timestamps are epoch milliseconds
 * (UTC), analytical dates are 'YYYY-MM-DD'. They deliberately carry no
 * broker-specific shape and no methodology-specific concept.
 */

/** Source platform is open text so a new integration needs no schema change. */
export type SourcePlatform = string

export type LifecycleStatus = 'ACTIVE' | 'ARCHIVED'
export type TradeDirection = 'LONG' | 'SHORT'
export type ExecutionSide = 'BUY' | 'SELL'
export type RuleKind = 'REQUIRED' | 'OPTIONAL' | 'CONDITIONAL'
export type EvaluationState = 'PASS' | 'FAIL' | 'N/A' | 'UNREVIEWED'
export type StrategyVersionState = 'DRAFT' | 'PUBLISHED'

export interface Account {
  id: string
  displayName: string
  sourcePlatform: SourcePlatform
  sourceAccountId: string | null
  currency: string
  timezone: string | null
  status: LifecycleStatus
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Strategy {
  id: string
  name: string
  description: string
  status: LifecycleStatus
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface StrategyVersion {
  id: string
  strategyId: string
  state: StrategyVersionState
  /** Sequential published number; null while a Draft. */
  versionNumber: number | null
  /** The published version this one was started from (lineage); null for the first. */
  baseVersionId: string | null
  publishedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface RuleGroup {
  id: string
  strategyVersionId: string
  name: string
  description: string
  position: number
}

export interface Rule {
  id: string
  strategyVersionId: string
  ruleGroupId: string
  title: string
  description: string
  kind: RuleKind
  position: number
}

export interface RuleGroupWithRules extends RuleGroup {
  rules: Rule[]
}

/** A version together with its full ordered group/rule definition. */
export interface StrategyVersionDefinition {
  version: StrategyVersion
  groups: RuleGroupWithRules[]
}

export interface Trade {
  id: string
  accountId: string
  sourcePlatform: SourcePlatform
  sourceTradeId: string | null
  sourcePositionId: string | null
  analyticalTradeDate: string
  instrument: string
  direction: TradeDirection
  quantity: Decimal
  openedAt: number
  closedAt: number | null
  avgEntryPrice: Decimal
  avgExitPrice: Decimal | null
  grossPnl: Decimal | null
  /**
   * Cost categories: signed P&L contributions (a cost is negative); null = not
   * reported / not applicable. net = gross + commission + fees + swap.
   */
  commission: Decimal | null
  fees: Decimal | null
  swap: Decimal | null
  netPnl: Decimal | null
  plannedR: Decimal | null
  realizedR: Decimal | null
  strategyVersionId: string | null
  createdAt: number
  updatedAt: number
}

export interface Execution {
  id: string
  tradeId: string
  accountId: string
  sourcePlatform: SourcePlatform
  sourceExecutionId: string | null
  sourcePositionId: string | null
  executedAt: number
  side: ExecutionSide
  quantity: Decimal
  price: Decimal
  /** Optional per-execution costs, same sign convention; null = not reported. */
  commission: Decimal | null
  fees: Decimal | null
  swap: Decimal | null
  createdAt: number
}

export interface TradeRuleEvaluation {
  id: string
  tradeId: string
  strategyVersionId: string
  ruleId: string
  state: EvaluationState
  evaluatedAt: number | null
  createdAt: number
  updatedAt: number
}

/** An evaluation joined with its rule as frozen in the evaluated version. */
export interface TradeRuleEvaluationDetail extends TradeRuleEvaluation {
  ruleTitle: string
  ruleDescription: string
  ruleKind: RuleKind
  rulePosition: number
  ruleGroupId: string
  ruleGroupName: string
  ruleGroupPosition: number
}

export interface TradeNote {
  tradeId: string
  body: string
  createdAt: number
  updatedAt: number
}

export interface DayNote {
  accountId: string
  tradeDate: string
  body: string
  createdAt: number
  updatedAt: number
}

export type MediaOwnerType = 'TRADE' | 'DAY'
export type MediaFormat = 'PNG' | 'JPEG' | 'WEBP'
export type MediaTimeframe = 'M1' | 'M3' | 'M5' | 'M15' | 'M30' | 'H1' | 'H2' | 'H4' | 'D1' | 'W1' | 'OTHER'
export type MediaStage = 'PRE_TRADE' | 'ENTRY' | 'MANAGEMENT' | 'EXIT' | 'POST_TRADE'

/** Chart Evidence metadata row. Image bytes live on disk; `managedPath` is relative to the media root. */
export interface TradeMedia {
  id: string
  ownerType: MediaOwnerType
  tradeId: string | null
  accountId: string
  analyticalDate: string | null
  managedPath: string
  format: MediaFormat
  timeframe: MediaTimeframe
  stage: MediaStage
  caption: string | null
  /** Trade-level only; a Day media row is never featured. At most one featured row per Trade. */
  isFeatured: boolean
  createdAt: number
}
