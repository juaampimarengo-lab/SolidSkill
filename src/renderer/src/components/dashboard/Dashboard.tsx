import type { JSX } from 'react'
import { MetricsSummary } from './MetricsSummary'
import { EquityChart } from './EquityChart'
import { PerformanceByDay } from './PerformanceByDay'
import { ProcessCompliance } from './ProcessCompliance'
import { JournalPreview } from './JournalPreview'
import { CalendarPreview } from './CalendarPreview'
import { StrategyCompliancePreview } from './StrategyCompliancePreview'
import styles from './Dashboard.module.css'

export function Dashboard(): JSX.Element {
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

      <JournalPreview />

      <div className={styles.rowSplit}>
        <CalendarPreview />
        <StrategyCompliancePreview />
      </div>
    </div>
  )
}
