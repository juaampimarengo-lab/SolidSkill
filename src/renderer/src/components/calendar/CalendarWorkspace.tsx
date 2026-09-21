import { useMemo, useState, type JSX } from 'react'
import { ChevronLeft, ChevronRight, StickyNote } from 'lucide-react'
import type { TradingData } from '@renderer/hooks/useTrading'
import { buildCalendarMonth, calendarRange, groupByDate, monthOfIso, todayIsoDate } from '@renderer/lib/calendar'
import type { CalendarDayCell, CalendarOutcome, WeeklySummaryData } from '@renderer/types/calendar'
import { formatUsdCompact, formatUsdCompactK } from '@renderer/lib/format'
import styles from './CalendarWorkspace.module.css'

const weekdayLabels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const numClassByOutcome: Record<CalendarOutcome, string> = {
  positive: 'num--positive',
  negative: 'num--negative',
  'break-even': 'num--neutral',
  'no-trade': ''
}

const cellOutcomeClass: Record<CalendarOutcome, string> = {
  positive: styles.cellPositive,
  negative: styles.cellNegative,
  'break-even': styles.cellBreakEven,
  'no-trade': ''
}

function formatWinRate(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(2)}%`
}

interface CalendarWorkspaceProps {
  trading: TradingData
  onOpenDayReview: (date: string) => void
}

export function CalendarWorkspace({ trading, onOpenDayReview }: CalendarWorkspaceProps): JSX.Element {
  // Every populated day derives from persisted Trades grouped by their
  // analytical trading date. The navigable months span the persisted trades
  // and the current month (see lib/calendar.ts).
  const todayIso = todayIsoDate()
  const { trades, noteDates } = trading
  const monthRefs = useMemo(() => calendarRange(trades, todayIso), [trades, todayIso])
  const months = useMemo(() => {
    const byDate = groupByDate(trades)
    return monthRefs.map((ref) => buildCalendarMonth(ref, byDate, noteDates, todayIso))
  }, [monthRefs, trades, noteDates, todayIso])
  const currentMonthIndex = useMemo(() => {
    const current = monthOfIso(todayIso)
    return Math.max(0, monthRefs.findIndex((m) => m.year === current.year && m.month === current.month))
  }, [monthRefs, todayIso])

  const [monthIndex, setMonthIndex] = useState(currentMonthIndex)
  const [selected, setSelected] = useState<string | null>(null)

  const month = months[Math.min(monthIndex, months.length - 1)] as (typeof months)[number]

  const gridTemplateRows = useMemo(() => `auto repeat(${month.weeks.length}, 1fr)`, [month.weeks.length])

  const canGoPrev = monthIndex > 0
  const canGoNext = monthIndex < months.length - 1

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => setMonthIndex((i) => i - 1)}
            disabled={!canGoPrev}
            aria-label="Previous month"
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <span className={styles.monthLabel}>{month.monthLabel}</span>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => setMonthIndex((i) => i + 1)}
            disabled={!canGoNext}
            aria-label="Next month"
          >
            <ChevronRight size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={styles.thisMonthButton}
            onClick={() => setMonthIndex(currentMonthIndex)}
          >
            This month
          </button>
        </div>

        <div className={styles.monthlyStats}>
          <span className={styles.statsLabel}>Monthly stats</span>
          <span
            className={`num ${styles.statsValue} ${
              numClassByOutcome[month.monthlyStats.outcome]
            }`}
          >
            {formatUsdCompactK(month.monthlyStats.result)}
          </span>
          <span className={styles.statsDivider}>·</span>
          <span className={styles.statsDays}>{month.monthlyStats.tradedDays} days</span>
        </div>
      </header>

      <div className={styles.grid} style={{ gridTemplateRows }}>
        {weekdayLabels.map((label) => (
          <div key={label} className={styles.weekdayHeader}>
            {label}
          </div>
        ))}
        <div className={styles.weekSummaryHeader} />

        {month.weeks.map((week, weekIndex) => (
          <WeekRow
            key={weekIndex}
            week={week}
            weekIndex={weekIndex}
            monthIndex={monthIndex}
            summary={month.weeklySummaries[weekIndex]}
            selected={selected}
            onSelect={setSelected}
            onOpenDayReview={onOpenDayReview}
          />
        ))}
      </div>
    </div>
  )
}

function WeekRow({
  week,
  weekIndex,
  monthIndex,
  summary,
  selected,
  onSelect,
  onOpenDayReview
}: {
  week: CalendarDayCell[]
  weekIndex: number
  monthIndex: number
  summary: WeeklySummaryData
  selected: string | null
  onSelect: (key: string | null) => void
  onOpenDayReview: (date: string) => void
}): JSX.Element {
  return (
    <>
      {week.map((cell, cellIndex) => {
        const key = `${monthIndex}-${weekIndex}-${cellIndex}`
        const interactive = cell.inMonth && cell.trades > 0 && Boolean(cell.dateKey)
        return (
          <DayCell
            key={key}
            cell={cell}
            isSelected={selected === key}
            interactive={interactive}
            onSelect={() => {
              onSelect(selected === key ? null : cell.inMonth ? key : null)
              if (interactive) onOpenDayReview(cell.dateKey as string)
            }}
          />
        )
      })}
      <WeekSummaryCell summary={summary} />
    </>
  )
}

function DayCell({
  cell,
  isSelected,
  interactive,
  onSelect
}: {
  cell: CalendarDayCell
  isSelected: boolean
  interactive: boolean
  onSelect: () => void
}): JSX.Element {
  const classes = [
    styles.dayCell,
    cellOutcomeClass[cell.outcome],
    !cell.inMonth ? styles.dayCellOutside : '',
    isSelected ? styles.dayCellSelected : '',
    interactive ? styles.dayCellInteractive : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" className={classes} onClick={interactive ? onSelect : undefined} disabled={!interactive}>
      <div className={styles.dayCellHead}>
        <span className={styles.dateGroup}>
          <span className={styles.dateNumber}>{cell.date}</span>
          {cell.isToday && <span className={styles.todayDot} />}
        </span>
        {cell.hasJournalEntry && <StickyNote size={12} strokeWidth={1.75} className={styles.journalIcon} />}
      </div>

      {cell.result !== null && (
        <div className={styles.dayCellBody}>
          <span className={`num ${styles.resultValue} ${numClassByOutcome[cell.outcome]}`}>
            {formatUsdCompact(cell.result)}
          </span>
          <span className={styles.tradeCount}>
            {cell.trades} {cell.trades === 1 ? 'trade' : 'trades'}
          </span>
          {cell.winRate !== null && (
            <span className={`num ${styles.winRate}`}>{formatWinRate(cell.winRate)}</span>
          )}
        </div>
      )}
    </button>
  )
}

function WeekSummaryCell({ summary }: { summary: WeeklySummaryData }): JSX.Element {
  return (
    <div className={styles.weekSummaryCell}>
      <span className={styles.weekLabel}>{summary.label}</span>
      <span className={`num ${styles.weekResult} ${numClassByOutcome[summary.outcome]}`}>
        {formatUsdCompactK(summary.result)}
      </span>
      <span className={styles.weekDays}>
        {summary.tradedDays} {summary.tradedDays === 1 ? 'day' : 'days'}
      </span>
    </div>
  )
}
