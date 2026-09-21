import type { JSX } from 'react'
import { MetricsSummary } from './MetricsSummary'
import { EquityChart } from './EquityChart'
import { PerformanceByDay } from './PerformanceByDay'
import { ProcessCompliance } from './ProcessCompliance'
import { JournalPreview } from './JournalPreview'
import { CalendarPreview } from './CalendarPreview'
import { StrategyCompliancePreview } from './StrategyCompliancePreview'
import type { TradingData } from '@renderer/hooks/useTrading'
import styles from './Dashboard.module.css'

interface DashboardProps {
  trading: TradingData
  onOpenTradeReview: (tradeId: string) => void
  onOpenDayReview: (date: string) => void
}

export function Dashboard({ trading, onOpenTradeReview, onOpenDayReview }: DashboardProps): JSX.Element {
  return (
    <div className={styles.page}>
      <div className={styles.rowSplit}>
        <MetricsSummary />
        <EquityChart />
      </div>

      <div className={styles.rowSplit}>
        <PerformanceByDay />
        <ProcessCompliance />
      </div>

      <JournalPreview trades={trading.trades} onOpenTradeReview={onOpenTradeReview} />

      <div className={styles.rowSplit}>
        <CalendarPreview trades={trading.trades} noteDates={trading.noteDates} onOpenDayReview={onOpenDayReview} />
        <StrategyCompliancePreview />
      </div>
    </div>
  )
}
