// Small display-only derivations from the shared journalTrades fixture
// universe (Checkpoint 008). No trade reconstruction, no independent trade
// data — every value here is read straight off an already-computed
// JournalTrade fixture.

import { journalTrades } from '@renderer/data/journalDummyData'
import { tradeSummary } from '@renderer/lib/compliance'
import type { RecentTrade } from '@renderer/types/dummy'
import type { JournalTrade } from '@renderer/types/journal'

function toRecentTrade(trade: JournalTrade): RecentTrade {
  return {
    id: trade.id,
    time: trade.openTime.slice(0, 5),
    instrument: trade.instrument,
    side: trade.direction,
    qty: trade.qty,
    entry: trade.avgEntry,
    exit: trade.avgExit,
    resultUsd: trade.netPnl,
    outcome: trade.outcome,
    r: trade.realizedR ?? 0,
    strategy: trade.strategy,
    compliance: tradeSummary(trade.complianceRules)
  }
}

// journalTrades is authored in chronological order (oldest first) — the
// most recent trades are simply the tail of the array, reversed.
export function recentTrades(limit = 6): RecentTrade[] {
  return journalTrades.slice(-limit).reverse().map(toRecentTrade)
}
