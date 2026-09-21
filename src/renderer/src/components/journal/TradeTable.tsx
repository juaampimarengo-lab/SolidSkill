import type { JSX, ReactNode } from 'react'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import type { TradeSummary } from '@renderer/types/journal'
import { formatPrice, formatR, formatUsd } from '@renderer/lib/format'
import {
  complianceOf,
  dateLabel,
  durationLabel,
  openTimeLabel,
  outcomeNumClass,
  strategyName,
  tradeOutcome
} from '@renderer/lib/tradeView'
import styles from './TradeTable.module.css'

// A small local column definition array — not a generalized configurable-
// column framework (per docs/JOURNAL_SPEC.md §12, that's future work), but
// structured so future show/hide/reorder support can consume this list
// instead of rewriting the table markup.
interface TradeColumn {
  key: string
  label: string
  align: 'left' | 'right'
  render: (trade: TradeSummary) => ReactNode
}

const columns: TradeColumn[] = [
  { key: 'date', label: 'Date', align: 'left', render: (t) => dateLabel(t.tradeDate) },
  { key: 'time', label: 'Time', align: 'left', render: (t) => openTimeLabel(t).slice(0, 5) },
  { key: 'instrument', label: 'Instrument', align: 'left', render: (t) => t.instrument },
  {
    key: 'direction',
    label: 'Direction',
    align: 'left',
    render: (t) => (t.direction === 'Long' ? 'Long' : 'Short')
  },
  { key: 'qty', label: 'Qty', align: 'right', render: (t) => t.quantity },
  { key: 'avgEntry', label: 'Avg Entry', align: 'right', render: (t) => formatPrice(t.avgEntry) },
  { key: 'avgExit', label: 'Avg Exit', align: 'right', render: (t) => (t.avgExit === null ? '—' : formatPrice(t.avgExit)) },
  { key: 'netPnl', label: 'Net P&L', align: 'right', render: (t) => (t.netPnl === null ? '—' : formatUsd(t.netPnl)) },
  {
    key: 'r',
    label: 'R',
    align: 'right',
    render: (t) => (t.realizedR === null ? '—' : formatR(t.realizedR))
  },
  { key: 'strategy', label: 'Strategy', align: 'left', render: (t) => strategyName(t) },
  { key: 'compliance', label: 'Compliance', align: 'left', render: (t) => <CompactCompliance summary={complianceOf(t)} /> },
  { key: 'duration', label: 'Duration', align: 'right', render: (t) => durationLabel(t) }
]

interface TradeTableProps {
  trades: readonly TradeSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function TradeTable({ trades, selectedId, onSelect }: TradeTableProps): JSX.Element {
  return (
    <>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${styles.th} ${col.align === 'right' ? styles.thRight : styles.thLeft}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr
                key={trade.id}
                className={
                  trade.id === selectedId ? `${styles.row} ${styles.rowSelected}` : styles.row
                }
                onClick={() => onSelect(trade.id)}
              >
                {columns.map((col) => {
                  const isNumeric = col.key === 'qty' || col.key === 'netPnl' || col.key === 'r' || col.key === 'duration' || col.key === 'avgEntry' || col.key === 'avgExit'
                  const cellClass = [
                    styles.td,
                    col.align === 'right' ? styles.tdRight : styles.tdLeft,
                    isNumeric ? 'num' : '',
                    col.key === 'netPnl' || col.key === 'r' ? outcomeNumClass(tradeOutcome(trade)) : '',
                    col.key === 'duration' ? styles.tdMuted : '',
                    col.key === 'strategy' ? styles.tdStrategy : ''
                  ]
                    .filter(Boolean)
                    .join(' ')

                  if (col.key === 'compliance') {
                    return (
                      <td key={col.key} className={cellClass}>
                        <CompactCompliance summary={complianceOf(trade)} />
                      </td>
                    )
                  }

                  return (
                    <td key={col.key} className={cellClass}>
                      {col.render(trade)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {trades.length === 0 && <div className={styles.empty}>No trades match the current filters.</div>}
      </div>

      <div className={styles.footer}>
        <span>
          {trades.length} {trades.length === 1 ? 'trade' : 'trades'}
        </span>
      </div>
    </>
  )
}
