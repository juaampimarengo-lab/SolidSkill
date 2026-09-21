// Small display-only selections over the persisted Trade list. No trade
// reconstruction and no independent trade data: the list is the single Trade
// universe loaded once from SQLite (hooks/useTrading.ts).

import type { TradeSummary } from '@renderer/types/journal'

// The list is chronological (analytical date, then open time) — the most
// recent trades are simply the tail, reversed.
export function recentTrades(trades: readonly TradeSummary[], limit = 6): TradeSummary[] {
  return trades.slice(-limit).reverse()
}
