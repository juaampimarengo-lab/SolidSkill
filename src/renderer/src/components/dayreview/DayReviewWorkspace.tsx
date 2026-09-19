import { useMemo, type JSX } from 'react'
import { ArrowLeft } from 'lucide-react'
import { journalTrades } from '@renderer/data/journalDummyData'
import { aggregateDay } from '@renderer/lib/dayAggregate'
import { formatPercent, formatR, formatUsd } from '@renderer/lib/format'
import type { JournalTrade } from '@renderer/types/journal'
import { IntradayPnlChart } from './IntradayPnlChart'
import styles from './DayReviewWorkspace.module.css'

const complianceModifier: Record<JournalTrade['compliance'], string> = {
  Compliant: styles.badgePositive,
  Violation: styles.badgeNegative,
  Partial: styles.badgeWarning
}

function outcomeNumClass(outcome: JournalTrade['outcome'] | 'no-trade'): string {
  if (outcome === 'break-even' || outcome === 'no-trade') return 'num--neutral'
  return `num--${outcome}`
}

interface DayReviewWorkspaceProps {
  date: string
  onBack: () => void
  onOpenTrade: (tradeId: string) => void
}

export function DayReviewWorkspace({ date, onBack, onOpenTrade }: DayReviewWorkspaceProps): JSX.Element {
  const dayTrades = useMemo(
    () =>
      journalTrades
        .filter((t) => t.date === date)
        .slice()
        .sort((a, b) => a.openTime.localeCompare(b.openTime)),
    [date]
  )

  const agg = useMemo(() => aggregateDay(dayTrades), [dayTrades])
  const dayNote = dayTrades.find((t) => t.dayNote)?.dayNote ?? null
  const account = dayTrades[0]?.account ?? 'Apex 50K'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <button type="button" className={styles.backButton} onClick={onBack}>
            <ArrowLeft size={14} strokeWidth={1.75} />
            Back
          </button>
          <div className={styles.headerTitle}>
            <span className={styles.date}>{date}, 2026</span>
            <span className={styles.account}>{account}</span>
          </div>
        </div>

        <div className={styles.statsStrip}>
          <Stat label="Net P&L" value={formatUsd(agg.netPnl)} numClass={outcomeNumClass(agg.outcome)} />
          <Stat label="Gross P&L" value={formatUsd(agg.grossPnl)} />
          <Stat label="Fees" value={formatUsd(-agg.fees)} />
          <Stat label="Trades" value={String(agg.trades)} />
          <Stat label="Win Rate" value={agg.winRate === null ? '—' : formatPercent(agg.winRate)} />
          <Stat label="Winners" value={String(agg.winners)} numClass="num--positive" />
          <Stat label="Losers" value={String(agg.losers)} numClass="num--negative" />
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.tradesRegion}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Time</th>
                <th className={styles.thLeft}>Instrument</th>
                <th className={styles.thLeft}>Direction</th>
                <th className={styles.thRight}>Qty</th>
                <th className={styles.thRight}>Net P&L</th>
                <th className={styles.thRight}>R</th>
                <th className={styles.thLeft}>Strategy</th>
                <th className={styles.thLeft}>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {dayTrades.map((trade) => (
                <tr key={trade.id} className={styles.row} onClick={() => onOpenTrade(trade.id)}>
                  <td className={`num ${styles.tdLeft} ${styles.time}`}>{trade.openTime.slice(0, 5)}</td>
                  <td className={styles.tdLeft}>{trade.instrument}</td>
                  <td className={styles.tdLeft}>{trade.direction}</td>
                  <td className={`num ${styles.tdRight}`}>{trade.qty}</td>
                  <td className={`num ${styles.tdRight} ${outcomeNumClass(trade.outcome)}`}>
                    {formatUsd(trade.netPnl)}
                  </td>
                  <td className={`num ${styles.tdRight} ${outcomeNumClass(trade.outcome)}`}>
                    {trade.realizedR === null ? '—' : formatR(trade.realizedR)}
                  </td>
                  <td className={styles.tdLeft}>{trade.strategy}</td>
                  <td className={styles.tdLeft}>
                    <span className={`${styles.badge} ${complianceModifier[trade.compliance]}`}>
                      {trade.compliance}
                    </span>
                  </td>
                </tr>
              ))}

              {dayTrades.length === 0 && (
                <tr>
                  <td colSpan={8} className={styles.empty}>
                    No trades recorded for this day.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.sideColumn}>
          <div className={styles.chartRegion}>
            <div className={styles.noteTitle}>Intraday Cumulative Net P&L</div>
            <IntradayPnlChart dayTrades={dayTrades} />
          </div>

          <div className={styles.notesRegion}>
            <div className={styles.noteTitle}>Day Notes</div>
            <p className={styles.noteText}>{dayNote ?? 'No day notes recorded.'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, numClass }: { label: string; value: string; numClass?: string }): JSX.Element {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`num ${styles.statValue} ${numClass ?? ''}`}>{value}</span>
    </div>
  )
}
