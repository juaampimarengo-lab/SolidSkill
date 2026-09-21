import { useMemo, useState, type JSX } from 'react'
import type { TradingData } from '@renderer/hooks/useTrading'
import { complianceOf, tradeOutcome } from '@renderer/lib/tradeView'
import type { Outcome, TradeSummary } from '@renderer/types/journal'
import { JournalFilters, defaultJournalFilters, type JournalFilterState } from './JournalFilters'
import { TradeTable } from './TradeTable'
import { TradeReview } from './TradeReview'
import styles from './JournalWorkspace.module.css'

function tradeOutcomeLabel(outcome: Outcome): string {
  if (outcome === 'positive') return 'Win'
  if (outcome === 'negative') return 'Loss'
  return 'Break-even'
}

function matchesFilters(trade: TradeSummary, filters: JournalFilterState): boolean {
  if (filters.instrument !== 'All' && trade.instrument !== filters.instrument) return false
  if (filters.direction !== 'All' && trade.direction !== filters.direction) return false
  // Strategy filter compares the stable strategy id, not the display name.
  if (filters.strategy !== 'All' && trade.strategy?.strategyId !== filters.strategy) return false
  if (filters.outcome !== 'All' && tradeOutcomeLabel(tradeOutcome(trade)) !== filters.outcome) return false
  if (filters.review !== 'All' && (complianceOf(trade).reviewComplete ? 'Complete' : 'Incomplete') !== filters.review)
    return false
  return true
}

interface JournalWorkspaceProps {
  trading: TradingData
  onOpenTradeReview: (tradeId: string) => void
}

export function JournalWorkspace({ trading, onOpenTradeReview }: JournalWorkspaceProps): JSX.Element {
  const { trades, account } = trading
  const [filters, setFilters] = useState<JournalFilterState>(defaultJournalFilters)
  // undefined = untouched (first trade is selected by default); null = the user closed the panel.
  const [pickedId, setPickedId] = useState<string | null | undefined>(undefined)
  const selectedId = pickedId === undefined ? (trades[0]?.id ?? null) : pickedId

  const filteredTrades = useMemo(() => trades.filter((trade) => matchesFilters(trade, filters)), [trades, filters])

  const selectedTrade = filteredTrades.find((trade) => trade.id === selectedId) ?? null

  return (
    <div className={styles.page}>
      <JournalFilters accountName={account?.displayName ?? '—'} trades={trades} filters={filters} onChange={setFilters} />

      <div className={styles.body}>
        <div className={styles.tableRegion}>
          <TradeTable trades={filteredTrades} selectedId={selectedTrade?.id ?? null} onSelect={setPickedId} />
        </div>

        {selectedTrade && (
          <div className={styles.reviewRegion}>
            <TradeReview
              trade={selectedTrade}
              onClose={() => setPickedId(null)}
              onOpenFull={() => onOpenTradeReview(selectedTrade.id)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
