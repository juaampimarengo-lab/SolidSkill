// Renderer view types for the trading surfaces. The data itself is persisted in
// SQLite and arrives over the typed preload API (src/shared/ipc/trades.ts):
// money/price/quantity/R are exact decimal STRINGS, timestamps are epoch ms,
// and days are keyed by the persisted analytical trading date ('YYYY-MM-DD').
// Nothing here is a fixture, and nothing broker-specific is represented.

import type {
  DirectionDto,
  ExecutionDto,
  ExecutionSideDto,
  RuleStateDto,
  TradeDetailDto,
  TradeSummaryDto
} from '@shared/ipc/trades'

export type Direction = DirectionDto
export type ExecutionSide = ExecutionSideDto
export type Outcome = 'positive' | 'negative' | 'break-even'
// UNREVIEWED = not yet evaluated (default); distinct from N/A = explicitly
// judged not applicable. See docs/STRATEGY_BUILDER_SPEC.md §9.
export type RuleState = RuleStateDto

export type TradeSummary = TradeSummaryDto
export type TradeDetail = TradeDetailDto
export type TradeExecution = ExecutionDto
