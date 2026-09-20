// Display-only join of the shared journalTrades FIXTURES to a strategy by
// name (temporary; see fixtureNameFor). Trades keep the strategy VERSION recorded on the fixture — nothing
// here (or in the workspace's session state) can rewrite that association.

import { journalTrades } from '@renderer/data/journalDummyData'
import type { Strategy } from '@renderer/types/strategy'
import { pooledSummary, summarizeRules, type ComplianceSummary } from '@renderer/lib/compliance'
import type { JournalTrade } from '@renderer/types/journal'

export interface StrategyTradeRow {
  trade: JournalTrade
  summary: ComplianceSummary
}

// TEMPORARY 011B-1 COMPATIBILITY ADAPTER — reads FIXTURE trades only.
// Journal trades are not persisted yet, and the fixture trades identify their
// strategy by display name, so this matches on the persisted strategy's CURRENT
// name. Consequence (accepted until 011B-2): renaming a strategy detaches the
// fixture trades from it in this tab. Persistent trades will associate by
// stable Strategy identity AND exact Strategy Version identity, never by name.
function fixtureNameFor(strategy: Strategy): string {
  return strategy.name
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
