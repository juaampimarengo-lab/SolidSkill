import { useMemo, type JSX } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useDay } from '@renderer/hooks/useTrading'
import { aggregateDay } from '@renderer/lib/dayAggregate'
import { formatPercent, formatR, formatUsd } from '@renderer/lib/format'
import { complianceOf, longDateLabel, openTimeLabel, outcomeNumClass, strategyName, tradeOutcome } from '@renderer/lib/tradeView'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import { DataStatus } from '@renderer/components/shared/DataStatus'
import { DayCharts } from '@renderer/components/journal/DayCharts'
import type { DayDto } from '@shared/ipc/trades'
import { IntradayPnlChart } from './IntradayPnlChart'
import { DayNoteEditor } from './DayNoteEditor'
import styles from './DayReviewWorkspace.module.css'

interface DayReviewWorkspaceProps {
  accountId: string
  // Analytical trading date, 'YYYY-MM-DD'.
  date: string
  onBack: () => void
  onOpenTrade: (tradeId: string) => void
}

export function DayReviewWorkspace({ accountId, date, onBack, onOpenTrade }: DayReviewWorkspaceProps): JSX.Element {
  // The persisted day: this account's trades for this analytical date, plus
  // the Day Note (account + date). Nothing is derived from timestamps here.
  const day = useDay(accountId, date)

  if (day.state.status !== 'ready') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <button type="button" className={styles.backButton} onClick={onBack}>
              <ArrowLeft size={14} strokeWidth={1.75} />
              Back
            </button>
            <div className={styles.headerTitle}>
              <span className={styles.date}>{longDateLabel(date)}</span>
            </div>
          </div>
        </header>
        <DataStatus what="Day review" state={day.state} onRetry={day.retry} />
      </div>
    )
  }
  return <DayReview day={day.state.data} onBack={onBack} onOpenTrade={onOpenTrade} />
}

function DayReview({
  day,
  onBack,
  onOpenTrade
}: {
  day: DayDto
  onBack: () => void
  onOpenTrade: (tradeId: string) => void
}): JSX.Element {
  const dayTrades = day.trades
  const agg = useMemo(() => aggregateDay(dayTrades), [dayTrades])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <button type="button" className={styles.backButton} onClick={onBack}>
            <ArrowLeft size={14} strokeWidth={1.75} />
            Back
          </button>
          <div className={styles.headerTitle}>
            <span className={styles.date}>{longDateLabel(day.date)}</span>
            <span className={styles.account}>{day.accountName}</span>
          </div>
        </div>

        <div className={styles.statsStrip}>
          <Stat
            label="Net P&L"
            value={agg.netPnl === null ? '—' : formatUsd(agg.netPnl)}
            numClass={outcomeNumClass(agg.outcome)}
          />
          <Stat label="Gross P&L" value={agg.grossPnl === null ? '—' : formatUsd(agg.grossPnl)} />
          <Stat label="Fees" value={agg.costs === null ? '—' : formatUsd(agg.costs)} />
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
              {dayTrades.map((trade) => {
                const outcomeClass = outcomeNumClass(tradeOutcome(trade))
                return (
                  <tr key={trade.id} className={styles.row} onClick={() => onOpenTrade(trade.id)}>
                    <td className={`num ${styles.tdLeft} ${styles.time}`}>{openTimeLabel(trade).slice(0, 5)}</td>
                    <td className={styles.tdLeft}>{trade.instrument}</td>
                    <td className={styles.tdLeft}>{trade.direction}</td>
                    <td className={`num ${styles.tdRight}`}>{trade.quantity}</td>
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
            <DayNoteEditor key={`${day.accountId}:${day.date}`} accountId={day.accountId} date={day.date} initialBody={day.dayNote} />
          </div>

          <div className={styles.notesRegion}>
            <DayCharts accountId={day.accountId} date={day.date} />
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
