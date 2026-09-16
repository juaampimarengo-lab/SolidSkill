import type { JSX, ReactNode } from 'react'
import type { JournalTrade } from '@renderer/types/journal'
import { formatPrice, formatR, formatUsd } from '@renderer/lib/format'
import styles from './TradeTable.module.css'

// A small local column definition array — not a generalized configurable-
// column framework (per docs/JOURNAL_SPEC.md §12, that's future work), but
// structured so future show/hide/reorder support can consume this list
// instead of rewriting the table markup.
interface TradeColumn {
  key: string
  label: string
  align: 'left' | 'right'
  render: (trade: JournalTrade) => ReactNode
}

const complianceModifier: Record<JournalTrade['compliance'], string> = {
  Compliant: styles.badgePositive,
  Violation: styles.badgeNegative,
  Partial: styles.badgeWarning
}

function outcomeNumClass(outcome: JournalTrade['outcome']): string {
  return outcome === 'break-even' ? 'num--neutral' : `num--${outcome}`
}

const columns: TradeColumn[] = [
  { key: 'date', label: 'Date', align: 'left', render: (t) => t.date },
  { key: 'time', label: 'Time', align: 'left', render: (t) => t.openTime.slice(0, 5) },
  { key: 'instrument', label: 'Instrument', align: 'left', render: (t) => t.instrument },
  {
    key: 'direction',
    label: 'Direction',
    align: 'left',
    render: (t) => (t.direction === 'Long' ? 'Long' : 'Short')
  },
  { key: 'qty', label: 'Qty', align: 'right', render: (t) => t.qty },
  { key: 'avgEntry', label: 'Avg Entry', align: 'right', render: (t) => formatPrice(t.avgEntry) },
  { key: 'avgExit', label: 'Avg Exit', align: 'right', render: (t) => formatPrice(t.avgExit) },
  { key: 'netPnl', label: 'Net P&L', align: 'right', render: (t) => formatUsd(t.netPnl) },
  {
    key: 'r',
    label: 'R',
    align: 'right',
    render: (t) => (t.realizedR === null ? '—' : formatR(t.realizedR))
  },
  { key: 'strategy', label: 'Strategy', align: 'left', render: (t) => t.strategy },
  { key: 'compliance', label: 'Compliance', align: 'left', render: (t) => t.compliance },
  { key: 'duration', label: 'Duration', align: 'right', render: (t) => t.duration }
]

interface TradeTableProps {
  trades: JournalTrade[]
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
                    col.key === 'netPnl' || col.key === 'r' ? outcomeNumClass(trade.outcome) : '',
                    col.key === 'duration' ? styles.tdMuted : '',
                    col.key === 'strategy' ? styles.tdStrategy : ''
                  ]
                    .filter(Boolean)
                    .join(' ')

                  if (col.key === 'compliance') {
                    return (
                      <td key={col.key} className={cellClass}>
                        <span className={`${styles.badge} ${complianceModifier[trade.compliance]}`}>
                          {trade.compliance}
                        </span>
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
