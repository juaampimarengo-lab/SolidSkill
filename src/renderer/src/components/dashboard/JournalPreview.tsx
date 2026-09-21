import type { JSX } from 'react'
import { recentTrades } from '@renderer/lib/trades'
import { formatPrice, formatR, formatUsd } from '@renderer/lib/format'
import { complianceOf, openTimeLabel, outcomeNumClass, strategyName, tradeOutcome } from '@renderer/lib/tradeView'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import type { TradeSummary } from '@renderer/types/journal'
import styles from './JournalPreview.module.css'

interface JournalPreviewProps {
  trades: readonly TradeSummary[]
  onOpenTradeReview: (tradeId: string) => void
}

export function JournalPreview({ trades: allTrades, onOpenTradeReview }: JournalPreviewProps): JSX.Element {
  const trades = recentTrades(allTrades, 6)

  return (
    <section className={styles.widget}>
      <span className={styles.title}>Recent Trades</span>

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thLeft}>Time</th>
            <th className={styles.thLeft}>Instrument</th>
            <th className={styles.thLeft}>Side</th>
            <th className={styles.thRight}>Qty</th>
            <th className={styles.thRight}>Entry</th>
            <th className={styles.thRight}>Exit</th>
            <th className={styles.thRight}>Result</th>
            <th className={styles.thRight}>R</th>
            <th className={styles.thLeft}>Strategy</th>
            <th className={styles.thLeft}>Compliance</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const outcomeClass = outcomeNumClass(tradeOutcome(trade))
            return (
              <tr key={trade.id} className={styles.row} onClick={() => onOpenTradeReview(trade.id)}>
                <td className={`num ${styles.tdLeft} ${styles.time}`}>{openTimeLabel(trade).slice(0, 5)}</td>
                <td className={styles.tdLeft}>{trade.instrument}</td>
                <td className={styles.tdLeft}>{trade.direction}</td>
                <td className={`num ${styles.tdRight}`}>{trade.quantity}</td>
                <td className={`num ${styles.tdRight}`}>{formatPrice(trade.avgEntry)}</td>
                <td className={`num ${styles.tdRight}`}>{trade.avgExit === null ? '—' : formatPrice(trade.avgExit)}</td>
                <td className={`num ${styles.tdRight} ${outcomeClass}`}>
                  {trade.netPnl === null ? '—' : formatUsd(trade.netPnl)}
                </td>
                <td className={`num ${styles.tdRight} ${outcomeClass}`}>
                  {trade.realizedR === null ? '—' : formatR(trade.realizedR)}
                </td>
                <td className={styles.tdLeft}>{strategyName(trade)}</td>
                <td className={styles.tdLeft}>
                  <CompactCompliance summary={complianceOf(trade)} />
                </td>
              </tr>
            )
          })}
          {trades.length === 0 && (
            <tr>
              <td colSpan={10} className={styles.tdLeft}>
                No trades recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
