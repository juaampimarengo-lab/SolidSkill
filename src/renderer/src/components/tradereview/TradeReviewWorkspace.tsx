import { useMemo, useRef, useState, type JSX } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTradeDetail } from '@renderer/hooks/useTrading'
import { aggregateDay } from '@renderer/lib/dayAggregate'
import { fromScaled, toScaled } from '@renderer/lib/decimal'
import { formatR, formatUsd } from '@renderer/lib/format'
import {
  closeTimeLabel,
  dateLabel,
  durationLabel,
  longDateLabel,
  openTimeLabel,
  outcomeNumClass,
  tradeOutcome
} from '@renderer/lib/tradeView'
import { DataStatus } from '@renderer/components/shared/DataStatus'
import { ExecutionsTab, OverviewTab, StrategyTab } from '@renderer/components/journal/TradeReview'
import detailStyles from '@renderer/components/journal/TradeReview.module.css'
import type { TradeDetail } from '@renderer/types/journal'
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
  // Canonical Trade Review is driven by the persisted Trade identity: one
  // detail read returns the trade, its executions, the exact strategy version,
  // both notes and the same-day sibling trades.
  const { state, retry } = useTradeDetail(tradeId)

  // While a sibling loads, keep showing the previous trade instead of
  // collapsing the page to a loading screen for a moment.
  const lastReady = useRef<TradeDetail | null>(null)
  if (state.status === 'ready') lastReady.current = state.data
  const detail = state.status === 'ready' ? state.data : state.status === 'loading' ? lastReady.current : null

  if (detail === null) {
    const notFound = state.status === 'error' && state.code === 'NOT_FOUND'
    return (
      <div className={styles.page}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        {notFound ? (
          <p className={styles.empty}>Trade not found.</p>
        ) : (
          <DataStatus what="Trade review" state={state as { status: 'loading' } | { status: 'error'; message: string }} onRetry={retry} />
        )}
      </div>
    )
  }

  return <TradeReview detail={detail} activeTradeId={tradeId} onBack={onBack} onSwitchTrade={onSwitchTrade} />
}

function TradeReview({
  detail,
  activeTradeId,
  onBack,
  onSwitchTrade
}: {
  detail: TradeDetail
  activeTradeId: string
  onBack: () => void
  onSwitchTrade: (tradeId: string) => void
}): JSX.Element {
  const [tab, setTab] = useState<DetailTab>('Overview')
  const { trade, siblings } = detail
  const outcome = tradeOutcome(trade)

  const dayAgg = useMemo(() => aggregateDay(siblings), [siblings])

  // Exact running total across the day's trades, in chronological order.
  const runningPnl = useMemo(() => {
    let running = 0n
    return siblings.map((t) => {
      running += t.netPnl === null ? 0n : toScaled(t.netPnl)
      return { trade: t, cumulative: fromScaled(running) }
    })
  }, [siblings])

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
            {longDateLabel(trade.tradeDate)} · {openTimeLabel(trade).slice(0, 5)} – {closeTimeLabel(trade).slice(0, 5)} ·{' '}
            {durationLabel(trade)}
          </span>
        </div>
        <div className={styles.resultLine}>
          <span className={`num ${styles.resultValue} ${outcomeNumClass(outcome)}`}>
            {trade.netPnl === null ? '—' : formatUsd(trade.netPnl)}
          </span>
          {trade.realizedR !== null && (
            <span className={`num ${styles.resultR} ${outcomeNumClass(outcome)}`}>{formatR(trade.realizedR)}</span>
          )}
        </div>
      </header>

      <div className={styles.regions}>
        {/* LEFT CONTEXT REGION */}
        <div className={styles.contextRegion}>
          <div className={styles.contextHeader}>
            <span className={styles.contextDate}>{longDateLabel(trade.tradeDate)}</span>
            <span className={`num ${styles.contextResult} ${outcomeNumClass(dayAgg.outcome)}`}>
              {dayAgg.netPnl === null ? '—' : formatUsd(dayAgg.netPnl)}
            </span>
          </div>
          <div className={styles.contextSubline}>
            {dayAgg.trades} {dayAgg.trades === 1 ? 'trade' : 'trades'} · {dayAgg.winners}W / {dayAgg.losers}L
          </div>

          <div className={styles.contextList}>
            {siblings.map((t) => (
              <button
                key={t.id}
                type="button"
                className={t.id === activeTradeId ? `${styles.contextRow} ${styles.contextRowActive}` : styles.contextRow}
                onClick={() => {
                  if (t.id !== activeTradeId) onSwitchTrade(t.id)
                }}
              >
                <span className={styles.contextRowTime}>{openTimeLabel(t).slice(0, 5)}</span>
                <span className={styles.contextRowInstrument}>{t.instrument}</span>
                <span className={`num ${styles.contextRowResult} ${outcomeNumClass(tradeOutcome(t))}`}>
                  {t.netPnl === null ? '—' : formatUsd(t.netPnl)}
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
            {tab === 'Executions' && <ExecutionsTab detail={detail} />}
            {tab === 'Strategy' && <StrategyTab detail={detail} />}
          </div>
        </div>

        {/* MAIN ANALYSIS REGION */}
        <div className={styles.analysisRegion}>
          <div className={styles.analysisBlock}>
            <div className={styles.blockTitle}>Execution Visualization</div>
            <TradeChart trade={trade} executions={detail.executions} />
          </div>

          <div className={styles.analysisBlock}>
            <div className={styles.blockTitle}>Trade Notes</div>
            <p className={styles.noteText}>{detail.tradeNote || 'No trade notes recorded.'}</p>
          </div>

          <div className={styles.analysisBlock}>
            <div className={styles.blockTitle}>Day Notes</div>
            <p className={styles.noteText}>{detail.dayNote || 'No day notes recorded.'}</p>
          </div>

          <div className={styles.analysisBlock}>
            <div className={styles.blockTitle}>Running P&L — {dateLabel(trade.tradeDate)}</div>
            <div className={styles.runningList}>
              {runningPnl.map(({ trade: t, cumulative }) => (
                <div
                  key={t.id}
                  className={t.id === activeTradeId ? `${styles.runningRow} ${styles.runningRowActive}` : styles.runningRow}
                >
                  <span className={styles.runningTime}>{openTimeLabel(t).slice(0, 5)}</span>
                  <span className={styles.runningInstrument}>{t.instrument}</span>
                  <span className={`num ${styles.runningValue} ${outcomeNumClass(tradeOutcome(t))}`}>
                    {t.netPnl === null ? '—' : formatUsd(t.netPnl)}
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
