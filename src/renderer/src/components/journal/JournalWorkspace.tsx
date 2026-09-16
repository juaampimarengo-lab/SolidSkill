import { useMemo, useState, type JSX } from 'react'
import { journalTrades } from '@renderer/data/journalDummyData'
import type { JournalTrade } from '@renderer/types/journal'
import { JournalFilters, defaultJournalFilters, type JournalFilterState } from './JournalFilters'
import { TradeTable } from './TradeTable'
import { TradeReview } from './TradeReview'
import styles from './JournalWorkspace.module.css'

function tradeOutcomeLabel(outcome: JournalTrade['outcome']): string {
  if (outcome === 'positive') return 'Win'
  if (outcome === 'negative') return 'Loss'
  return 'Break-even'
}

function matchesFilters(trade: JournalTrade, filters: JournalFilterState): boolean {
  if (filters.instrument !== 'All' && trade.instrument !== filters.instrument) return false
  if (filters.direction !== 'All' && trade.direction !== filters.direction) return false
  if (filters.strategy !== 'All' && trade.strategy !== filters.strategy) return false
  if (filters.outcome !== 'All' && tradeOutcomeLabel(trade.outcome) !== filters.outcome) return false
  if (filters.compliance !== 'All' && trade.compliance !== filters.compliance) return false
  return true
}

export function JournalWorkspace(): JSX.Element {
  const [filters, setFilters] = useState<JournalFilterState>(defaultJournalFilters)
  const [selectedId, setSelectedId] = useState<string | null>(journalTrades[0]?.id ?? null)

  const filteredTrades = useMemo(
    () => journalTrades.filter((trade) => matchesFilters(trade, filters)),
    [filters]
  )

  const selectedTrade = filteredTrades.find((trade) => trade.id === selectedId) ?? null

  return (
    <div className={styles.page}>
      <JournalFilters trades={journalTrades} filters={filters} onChange={setFilters} />

      <div className={styles.body}>
        <div className={styles.tableRegion}>
          <TradeTable trades={filteredTrades} selectedId={selectedTrade?.id ?? null} onSelect={setSelectedId} />
        </div>

        {selectedTrade && (
          <div className={styles.reviewRegion}>
            <TradeReview trade={selectedTrade} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  )
}
