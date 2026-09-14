import type { JSX } from 'react'
import { formatPercent, formatR, formatUsd } from '@renderer/lib/format'
import styles from './MetricsSummary.module.css'

const secondaryMetrics = [
  { label: 'Win Rate', value: formatPercent(61.8) },
  { label: 'Avg R', value: formatR(1.24) },
  { label: 'Profit Factor', value: '1.87' },
  { label: 'Max Drawdown', value: formatUsd(-486.25) }
]

export function MetricsSummary(): JSX.Element {
  return (
    <section className={styles.widget}>
      <span className={styles.title}>Performance — This Week</span>

      <div className={styles.body}>
        <div className={styles.hero}>
          <span className={styles.heroLabel}>Net P&amp;L</span>
          <span className={`num ${styles.heroValue} num--positive`}>{formatUsd(1842.5)}</span>
        </div>

        <div className={styles.divider} />

        <div className={styles.grid}>
          {secondaryMetrics.map((metric) => (
            <div key={metric.label} className={styles.metric}>
              <span className={styles.metricLabel}>{metric.label}</span>
              <span
                className={`num ${styles.metricValue} ${
                  metric.value.startsWith('+')
                    ? 'num--positive'
                    : metric.value.startsWith('-')
                      ? 'num--negative'
                      : ''
                }`}
              >
                {metric.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
