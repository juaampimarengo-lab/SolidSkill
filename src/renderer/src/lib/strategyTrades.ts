// Display-only join of the shared journalTrades fixtures to a strategy by
// name. Trades keep the strategy VERSION recorded on the fixture — nothing
// here (or in the workspace's session state) can rewrite that association.

import { journalTrades } from '@renderer/data/journalDummyData'
import { seedStrategies } from '@renderer/data/strategyDummyData'
import type { Strategy } from '@renderer/types/strategy'
import { pooledSummary, summarizeRules, type ComplianceSummary } from '@renderer/lib/compliance'
import type { JournalTrade } from '@renderer/types/journal'

export interface StrategyTradeRow {
  trade: JournalTrade
  summary: ComplianceSummary
}

// SESSION-FIXTURE WORKAROUND ONLY. The fixture trades store a display name, so
// this resolves a strategy's id to its seed name to survive a session rename.
// Real persistence must associate a trade by stable Strategy identity AND exact
// Strategy Version identity — never by display name.
function fixtureNameFor(strategy: Strategy): string {
  return seedStrategies.find((s) => s.id === strategy.id)?.name ?? strategy.name
}

// Newest first. journalTrades is authored oldest-first.
export function tradesForStrategy(strategy: Strategy): StrategyTradeRow[] {
  const fixtureName = fixtureNameFor(strategy)
  return journalTrades
    .filter((t) => t.strategy === fixtureName)
    .slice()
    .reverse()
    .map((trade) => ({ trade, summary: summarizeRules(trade.complianceRules.map((r) => r.state)) }))
}

export interface StrategyAggregate {
  tradeCount: number
  fullyReviewed: number
  pooled: ComplianceSummary
  netPnl: number
}

export function aggregateStrategyTrades(rows: StrategyTradeRow[]): StrategyAggregate {
  return {
    tradeCount: rows.length,
    fullyReviewed: rows.filter((r) => r.summary.reviewComplete).length,
    pooled: pooledSummary(rows.map((r) => r.summary)),
    netPnl: rows.reduce((n, r) => n + r.trade.netPnl, 0)
  }
}

// Wording follows CLAUDE.md rule 4: small samples never produce strong claims.
export function sampleLabel(tradeCount: number): string {
  if (tradeCount === 0) return 'No trades'
  return tradeCount < 30 ? `Observation · n=${tradeCount}` : `Emerging pattern · n=${tradeCount}`
}
