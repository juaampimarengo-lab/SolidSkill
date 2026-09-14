import type { JSX } from 'react'
import { performanceByDay } from '@renderer/data/dummyData'
import { formatUsd } from '@renderer/lib/format'
import styles from './PerformanceByDay.module.css'

export function PerformanceByDay(): JSX.Element {
  const maxAbs = Math.max(...performanceByDay.map((d) => Math.abs(d.pnl)), 1)

  return (
    <section className={styles.widget}>
      <span className={styles.title}>Performance by Day</span>
      <div className={styles.rows}>
        {performanceByDay.map((day) => {
          const width = (Math.abs(day.pnl) / maxAbs) * 100
          return (
            <div key={day.label} className={styles.row}>
              <span className={styles.dayLabel}>{day.label}</span>
              <div className={styles.barTrack}>
                <div
                  className={
                    day.outcome === 'positive'
                      ? styles.barPositive
                      : day.outcome === 'negative'
                        ? styles.barNegative
                        : styles.barNeutral
                  }
                  style={{ width: `${Math.max(width, day.pnl === 0 ? 2 : width)}%` }}
                />
              </div>
              <span
                className={`num ${styles.value} ${
                  day.outcome === 'break-even' ? 'num--neutral' : `num--${day.outcome}`
                }`}
              >
                {formatUsd(day.pnl)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
