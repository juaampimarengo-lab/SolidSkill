// Selects the persisted Trades associated with a Strategy. The association is
// the stable Strategy id (and each trade's exact Strategy Version id) — never
// a display name, so renaming a Strategy cannot detach its trades, and a newer
// published version cannot move a historical trade. Trades keep the version
// they were evaluated against; nothing here can rewrite that.

import { pooledSummary, type ComplianceSummary } from '@renderer/lib/compliance'
import { sumDecimals, type Decimal } from '@renderer/lib/decimal'
import { complianceOf } from '@renderer/lib/tradeView'
import type { TradeSummary } from '@renderer/types/journal'

export interface StrategyTradeRow {
  trade: TradeSummary
  summary: ComplianceSummary
}

// Newest first. The persisted list is chronological (oldest first).
export function tradesForStrategy(strategyId: string, trades: readonly TradeSummary[]): StrategyTradeRow[] {
  return trades
    .filter((t) => t.strategy?.strategyId === strategyId)
    .slice()
    .reverse()
    .map((trade) => ({ trade, summary: complianceOf(trade) }))
}

export interface StrategyAggregate {
  tradeCount: number
  fullyReviewed: number
  pooled: ComplianceSummary
  netPnl: Decimal
}

export function aggregateStrategyTrades(rows: StrategyTradeRow[]): StrategyAggregate {
  return {
    tradeCount: rows.length,
    fullyReviewed: rows.filter((r) => r.summary.reviewComplete).length,
    pooled: pooledSummary(rows.map((r) => r.summary)),
    netPnl: sumDecimals(rows.map((r) => r.trade.netPnl))
  }
}

// Wording follows CLAUDE.md rule 4: small samples never produce strong claims.
export function sampleLabel(tradeCount: number): string {
  if (tradeCount === 0) return 'No trades'
  return tradeCount < 30 ? `Observation · n=${tradeCount}` : `Emerging pattern · n=${tradeCount}`
}
