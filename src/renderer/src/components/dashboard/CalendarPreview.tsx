import { useState, type JSX } from 'react'
import { calendarDays } from '@renderer/data/dummyData'
import { formatUsdCompact } from '@renderer/lib/format'
import styles from './CalendarPreview.module.css'

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const outcomeClass: Record<string, string> = {
  positive: styles.cellPositive,
  negative: styles.cellNegative,
  'break-even': styles.cellNeutral,
  none: ''
}

export function CalendarPreview(): JSX.Element {
  // UI-only selection state — no day-detail view, no persistence. Purely
  // so the "selected day" outline treatment has something to demonstrate.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  return (
    <section className={styles.widget}>
      <span className={styles.title}>Calendar — September</span>

      <div className={styles.weekdayRow}>
        {weekdays.map((day) => (
          <span key={day} className={styles.weekday}>
            {day}
          </span>
        ))}
      </div>

      <div className={styles.grid}>
        {calendarDays.map((day, i) => (
          <div
            key={i}
            onClick={day.inMonth ? () => setSelectedIndex(i) : undefined}
            className={`${styles.cell} ${outcomeClass[day.outcome]} ${!day.inMonth ? styles.cellOutside : ''} ${
              day.inMonth ? styles.cellInteractive : ''
            } ${selectedIndex === i ? styles.cellSelected : ''}`}
          >
            <div className={styles.cellHead}>
              <span className={styles.dateGroup}>
                <span className={styles.dateNumber}>{day.date}</span>
                {day.isToday && <span className={styles.todayDot} />}
              </span>
              {day.hasNote && <span className={styles.noteDot} />}
            </div>
            {day.pnl !== null && (
              <span
                className={`num ${styles.pnl} ${
                  day.outcome === 'break-even' ? 'num--neutral' : `num--${day.outcome}`
                }`}
              >
                {formatUsdCompact(day.pnl)}
              </span>
            )}
            {day.trades > 0 && <span className={styles.tradeCount}>{day.trades} trades</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
