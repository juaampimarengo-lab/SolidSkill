import type { JSX } from 'react'
import { MetricsSummary } from './MetricsSummary'
import { EquityChart } from './EquityChart'
import { PerformanceByDay } from './PerformanceByDay'
import { ProcessCompliance } from './ProcessCompliance'
import { JournalPreview } from './JournalPreview'
import { CalendarPreview } from './CalendarPreview'
import { StrategyCompliancePreview } from './StrategyCompliancePreview'
import styles from './Dashboard.module.css'

interface DashboardProps {
  onOpenTradeReview: (tradeId: string) => void
  onOpenDayReview: (date: string) => void
}

export function Dashboard({ onOpenTradeReview, onOpenDayReview }: DashboardProps): JSX.Element {
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

      <JournalPreview onOpenTradeReview={onOpenTradeReview} />

      <div className={styles.rowSplit}>
        <CalendarPreview onOpenDayReview={onOpenDayReview} />
        <StrategyCompliancePreview />
      </div>
    </div>
  )
}
