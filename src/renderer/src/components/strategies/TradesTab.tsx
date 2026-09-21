import type { JSX } from 'react'
import type { Strategy } from '@renderer/types/strategy'
import type { TradeSummary } from '@renderer/types/journal'
import { decimalSign } from '@renderer/lib/decimal'
import { formatR, formatUsd } from '@renderer/lib/format'
import { dateLabel, outcomeNumClass, tradeOutcome, versionLabel } from '@renderer/lib/tradeView'
import { currentVersion } from '@renderer/lib/strategyDraft'
import { tradesForStrategy, type StrategyTradeRow } from '@renderer/lib/strategyTrades'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import styles from './Strategies.module.css'

// Neutral, non-judging note that makes the process/outcome split visible.
function divergenceNote({ trade, summary }: StrategyTradeRow): string {
  if (summary.percent === null || trade.netPnl === null) return ''
  const sign = decimalSign(trade.netPnl)
  if (sign > 0 && summary.percent < 100) return 'Profit with rule FAIL'
  if (sign < 0 && summary.percent === 100) return 'Loss despite 100% evaluated compliance'
  return ''
}

interface TradesTabProps {
  strategy: Strategy
  trades: readonly TradeSummary[]
  onOpenTradeReview: (tradeId: string) => void
}

export function TradesTab({ strategy, trades, onOpenTradeReview }: TradesTabProps): JSX.Element {
  const rows = tradesForStrategy(strategy.id, trades)
  const current = currentVersion(strategy)

  if (rows.length === 0) {
    return <div className={styles.empty}>No trades are associated with this strategy yet.</div>
  }

  return (
    <div>
      <div className={styles.tabCaption}>
        Process ≠ outcome. Compliance is PASS / (PASS + FAIL) over rule results only — P&L is never an input. Each trade
        keeps the version it was evaluated against.
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thLeft}>Date</th>
            <th className={styles.thLeft}>Instrument</th>
            <th className={styles.thLeft}>Direction</th>
            <th className={styles.thRight}>Net P&L</th>
            <th className={styles.thRight}>R</th>
            <th className={styles.thLeft}>Version</th>
            <th className={styles.thLeft}>Compliance · Review</th>
            <th className={styles.thLeft}>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { trade, summary } = row
            const outcome = outcomeNumClass(tradeOutcome(trade))
            // Exact version identity, compared by persisted id.
            const isCurrent = current !== null && trade.strategy?.versionId === current.id
            return (
              <tr key={trade.id} className={styles.tr} onClick={() => onOpenTradeReview(trade.id)}>
                <td className={styles.td}>{dateLabel(trade.tradeDate)}</td>
                <td className={styles.td}>{trade.instrument}</td>
                <td className={styles.td}>{trade.direction}</td>
                <td className={`num ${styles.tdRight} ${outcome}`}>{trade.netPnl === null ? '—' : formatUsd(trade.netPnl)}</td>
                <td className={`num ${styles.tdRight} ${outcome}`}>
                  {trade.realizedR === null ? '—' : formatR(trade.realizedR)}
                </td>
                <td className={`num ${styles.td}`}>
                  {versionLabel(trade)}
                  {!isCurrent && <span className={styles.savedNote}> saved</span>}
                </td>
                <td className={styles.td}>
                  <CompactCompliance summary={summary} />
                </td>
                <td className={`${styles.td} ${styles.tdMuted}`}>{divergenceNote(row)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
