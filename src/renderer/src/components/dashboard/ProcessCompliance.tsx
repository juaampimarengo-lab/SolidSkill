import type { JSX } from 'react'
import styles from './ProcessCompliance.module.css'

const metrics = [
  { label: 'Strategy Compliance', value: '87%' },
  { label: 'Fully Compliant Trades', value: '7' },
  { label: 'Rule Violations', value: '2' },
  { label: 'Current Process Streak', value: '4' }
]

export function ProcessCompliance(): JSX.Element {
  return (
    <section className={styles.widget}>
      <span className={styles.title}>Process Compliance</span>
      <div className={styles.grid}>
        {metrics.map((metric) => (
          <div key={metric.label} className={styles.metric}>
            <span className={styles.label}>{metric.label}</span>
            <span className={`num ${styles.value}`}>{metric.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
