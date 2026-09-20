// Small display-only helpers for the Journal workspace's dummy fixtures.
// No trade reconstruction, no P&L/R calculation — every input here is
// already a computed fixture value; this only derives simple UI facts from
// them (entry/exit counts). Rule compliance lives in lib/compliance.ts.

import type { JournalExecution, JournalTrade } from '@renderer/types/journal'

// Entries/exits are read from the trade's already-known direction (the
// side that opened the exposure), never from which execution appears last —
// see docs/TRADE_MODEL_CONCEPTS.md §5. A SELL that closes a long, or a BUY
// that closes a short, must never be mistaken for the opening side.
export function openingSide(trade: JournalTrade): 'BUY' | 'SELL' {
  return trade.direction === 'Long' ? 'BUY' : 'SELL'
}

export function countEntries(trade: JournalTrade): number {
  const opening = openingSide(trade)
  return trade.executions.filter((execution: JournalExecution) => execution.side === opening).length
}

export function countExits(trade: JournalTrade): number {
  const opening = openingSide(trade)
  return trade.executions.filter((execution: JournalExecution) => execution.side !== opening).length
}
