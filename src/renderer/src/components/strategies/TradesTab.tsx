import type { JSX } from 'react'
import type { Strategy } from '@renderer/types/strategy'
import { formatR, formatUsd } from '@renderer/lib/format'
import { currentVersion } from '@renderer/lib/strategyDraft'
import { tradesForStrategy, type StrategyTradeRow } from '@renderer/lib/strategyTrades'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import styles from './Strategies.module.css'

// Neutral, non-judging note that makes the process/outcome split visible.
function divergenceNote({ trade, summary }: StrategyTradeRow): string {
  if (summary.percent === null) return ''
  if (trade.netPnl > 0 && summary.percent < 100) return 'Profit with rule FAIL'
  if (trade.netPnl < 0 && summary.percent === 100) return 'Loss despite 100% evaluated compliance'
  return ''
}

interface TradesTabProps {
  strategy: Strategy
  onOpenTradeReview: (tradeId: string) => void
}

export function TradesTab({ strategy, onOpenTradeReview }: TradesTabProps): JSX.Element {
  const rows = tradesForStrategy(strategy)
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
            const outcome = trade.outcome === 'break-even' ? 'num--neutral' : `num--${trade.outcome}`
            const isCurrent = current !== null && trade.strategyVersion === `v${current.number}`
            return (
              <tr key={trade.id} className={styles.tr} onClick={() => onOpenTradeReview(trade.id)}>
                <td className={styles.td}>{trade.date}</td>
                <td className={styles.td}>{trade.instrument}</td>
                <td className={styles.td}>{trade.direction}</td>
                <td className={`num ${styles.tdRight} ${outcome}`}>{formatUsd(trade.netPnl)}</td>
                <td className={`num ${styles.tdRight} ${outcome}`}>
                  {trade.realizedR === null ? '—' : formatR(trade.realizedR)}
                </td>
                <td className={`num ${styles.td}`}>
                  {trade.strategyVersion}
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
