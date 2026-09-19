import type { JSX } from 'react'
import { calendarMonths, currentMonthIndex } from '@renderer/data/calendarDummyData'
import type { CalendarDayCell, CalendarOutcome } from '@renderer/types/calendar'
import { formatUsdCompact } from '@renderer/lib/format'
import styles from './CalendarPreview.module.css'

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const outcomeClass: Record<CalendarOutcome, string> = {
  positive: styles.cellPositive,
  negative: styles.cellNegative,
  'break-even': styles.cellNeutral,
  'no-trade': ''
}

interface CalendarPreviewProps {
  onOpenDayReview: (date: string) => void
}

export function CalendarPreview({ onOpenDayReview }: CalendarPreviewProps): JSX.Element {
  const month = calendarMonths[currentMonthIndex]

  return (
    <section className={styles.widget}>
      <span className={styles.title}>Calendar — {month.monthLabel}</span>

      <div className={styles.weekdayRow}>
        {weekdays.map((day) => (
          <span key={day} className={styles.weekday}>
            {day}
          </span>
        ))}
      </div>

      <div className={styles.grid}>
        {month.weeks.flat().map((cell, i) => {
          const interactive = cell.inMonth && cell.trades > 0 && Boolean(cell.dateKey)
          return (
            <DayCell
              key={i}
              cell={cell}
              interactive={interactive}
              onOpen={interactive ? () => onOpenDayReview(cell.dateKey as string) : undefined}
            />
          )
        })}
      </div>
    </section>
  )
}

function DayCell({
  cell,
  interactive,
  onOpen
}: {
  cell: CalendarDayCell
  interactive: boolean
  onOpen?: () => void
}): JSX.Element {
  return (
    <div
      onClick={onOpen}
      className={`${styles.cell} ${outcomeClass[cell.outcome]} ${!cell.inMonth ? styles.cellOutside : ''} ${
        interactive ? styles.cellInteractive : ''
      }`}
    >
      <div className={styles.cellHead}>
        <span className={styles.dateGroup}>
          <span className={styles.dateNumber}>{cell.date}</span>
          {cell.isToday && <span className={styles.todayDot} />}
        </span>
        {cell.hasJournalEntry && <span className={styles.noteDot} />}
      </div>
      {cell.result !== null && (
        <span
          className={`num ${styles.pnl} ${cell.outcome === 'break-even' ? 'num--neutral' : `num--${cell.outcome}`}`}
        >
          {formatUsdCompact(cell.result)}
        </span>
      )}
      {cell.trades > 0 && <span className={styles.tradeCount}>{cell.trades} trades</span>}
    </div>
  )
}
