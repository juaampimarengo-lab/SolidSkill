import { useMemo, useState, type JSX } from 'react'
import { ArrowLeft } from 'lucide-react'
import { journalTrades } from '@renderer/data/journalDummyData'
import { aggregateDay } from '@renderer/lib/dayAggregate'
import { formatR, formatUsd } from '@renderer/lib/format'
import { ExecutionsTab, OverviewTab, StrategyTab, outcomeNumClass } from '@renderer/components/journal/TradeReview'
import detailStyles from '@renderer/components/journal/TradeReview.module.css'
import { TradeChart } from './TradeChart'
import styles from './TradeReviewWorkspace.module.css'

type DetailTab = 'Overview' | 'Executions' | 'Strategy'
const detailTabs: DetailTab[] = ['Overview', 'Executions', 'Strategy']

interface TradeReviewWorkspaceProps {
  tradeId: string
  onBack: () => void
  onSwitchTrade: (tradeId: string) => void
}

export function TradeReviewWorkspace({ tradeId, onBack, onSwitchTrade }: TradeReviewWorkspaceProps): JSX.Element {
  const [tab, setTab] = useState<DetailTab>('Overview')

  const trade = journalTrades.find((t) => t.id === tradeId)

  const dayTrades = useMemo(
    () =>
      journalTrades
        .filter((t) => t.date === trade?.date)
        .slice()
        .sort((a, b) => a.openTime.localeCompare(b.openTime)),
    [trade?.date]
  )

  const dayAgg = useMemo(() => aggregateDay(dayTrades), [dayTrades])

  let running = 0
  const runningPnl = dayTrades.map((t) => {
    running += t.netPnl
    return { trade: t, cumulative: running }
  })

  if (!trade) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        <p className={styles.empty}>Trade not found.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        <div className={styles.headerTitle}>
          <span className={styles.instrument}>{trade.instrument}</span>
          <span className={styles.direction}>{trade.direction}</span>
          <span className={styles.meta}>
            {trade.date}, 2026 · {trade.openTime.slice(0, 5)} – {trade.closeTime.slice(0, 5)} · {trade.duration}
          </span>
        </div>
        <div className={styles.resultLine}>
          <span className={`num ${styles.resultValue} ${outcomeNumClass(trade.outcome)}`}>
            {formatUsd(trade.netPnl)}
          </span>
          {trade.realizedR !== null && (
            <span className={`num ${styles.resultR} ${outcomeNumClass(trade.outcome)}`}>
              {formatR(trade.realizedR)}
            </span>
          )}
        </div>
      </header>

      <div className={styles.regions}>
        {/* LEFT CONTEXT REGION */}
        <div className={styles.contextRegion}>
          <div className={styles.contextHeader}>
            <span className={styles.contextDate}>{trade.date}, 2026</span>
            <span className={`num ${styles.contextResult} ${outcomeNumClass(dayAgg.outcome)}`}>
              {formatUsd(dayAgg.netPnl)}
            </span>
          </div>
          <div className={styles.contextSubline}>
            {dayAgg.trades} {dayAgg.trades === 1 ? 'trade' : 'trades'} · {dayAgg.winners}W / {dayAgg.losers}L
          </div>

          <div className={styles.contextList}>
            {dayTrades.map((t) => (
              <button
                key={t.id}
                type="button"
                className={t.id === trade.id ? `${styles.contextRow} ${styles.contextRowActive}` : styles.contextRow}
                onClick={() => {
                  if (t.id !== trade.id) onSwitchTrade(t.id)
                }}
              >
                <span className={styles.contextRowTime}>{t.openTime.slice(0, 5)}</span>
                <span className={styles.contextRowInstrument}>{t.instrument}</span>
                <span className={`num ${styles.contextRowResult} ${outcomeNumClass(t.outcome)}`}>
                  {formatUsd(t.netPnl)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* DETAIL REGION */}
        <div className={styles.detailRegion}>
          <div className={detailStyles.tabs} role="tablist" aria-label="Trade detail sections">
            {detailTabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? `${detailStyles.tab} ${detailStyles.tabActive}` : detailStyles.tab}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className={detailStyles.content}>
            {tab === 'Overview' && <OverviewTab trade={trade} />}
            {tab === 'Executions' && <ExecutionsTab trade={trade} />}
            {tab === 'Strategy' && <StrategyTab trade={trade} />}
          </div>
        </div>

        {/* MAIN ANALYSIS REGION */}
        <div className={styles.analysisRegion}>
          <div className={styles.analysisBlock}>
            <div className={styles.blockTitle}>Execution Visualization</div>
            <TradeChart trade={trade} />
          </div>

          <div className={styles.analysisBlock}>
            <div className={styles.blockTitle}>Trade Notes</div>
            <p className={styles.noteText}>{trade.tradeNote}</p>
          </div>

          <div className={styles.analysisBlock}>
            <div className={styles.blockTitle}>Day Notes</div>
            <p className={styles.noteText}>
              {dayTrades.find((t) => t.dayNote)?.dayNote ?? 'No day notes recorded.'}
            </p>
          </div>

          <div className={styles.analysisBlock}>
            <div className={styles.blockTitle}>Running P&L — {trade.date}</div>
            <div className={styles.runningList}>
              {runningPnl.map(({ trade: t, cumulative }) => (
                <div
                  key={t.id}
                  className={t.id === trade.id ? `${styles.runningRow} ${styles.runningRowActive}` : styles.runningRow}
                >
                  <span className={styles.runningTime}>{t.openTime.slice(0, 5)}</span>
                  <span className={styles.runningInstrument}>{t.instrument}</span>
                  <span className={`num ${styles.runningValue} ${outcomeNumClass(t.outcome)}`}>
                    {formatUsd(t.netPnl)}
                  </span>
                  <span className={`num ${styles.runningCumulative}`}>{formatUsd(cumulative)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
