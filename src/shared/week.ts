/**
 * Weekly Review week identity (Checkpoint 015, docs/WEEKLY_REVIEW.md §3).
 *
 * A review week is a deterministic 7-day interval of ANALYTICAL trading dates
 * ('YYYY-MM-DD'), identified by (account_id, week_start_date). The week-start
 * convention is this one explicit constant — never the browser/OS locale — and
 * matches the Calendar grid, whose weekly summary column already totals
 * Sunday → Saturday, so a Calendar week and a Weekly Review week can never
 * disagree about the same days.
 *
 * Pure calendar arithmetic on the date text: `Date.UTC` is used only as a
 * day-counter for weekday/offset math, never to read a trade's timestamp, so
 * no timezone can move a date into another week.
 */

/** 0 = Sunday … 6 = Saturday. Changing this is a product decision + a data migration of stored week starts. */
export const WEEK_START_DAY = 0

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

const pad = (n: number): string => String(n).padStart(2, '0')

function toDayNumber(isoDate: string): number {
  const match = ISO_DATE.exec(isoDate)
  if (match === null) throw new RangeError(`Invalid analytical date: ${JSON.stringify(isoDate)}`)
  const [, y, m, d] = match
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d))
  const probe = new Date(ms)
  if (probe.getUTCFullYear() !== Number(y) || probe.getUTCMonth() !== Number(m) - 1 || probe.getUTCDate() !== Number(d)) {
    throw new RangeError(`Not a real calendar date: ${isoDate}`)
  }
  return Math.round(ms / DAY_MS)
}

function fromDayNumber(day: number): string {
  const date = new Date(day * DAY_MS)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 0 = Sunday … 6 = Saturday, for an analytical date. */
export function weekdayOf(isoDate: string): number {
  // Day 0 of the epoch (1970-01-01) was a Thursday (4).
  return (((toDayNumber(isoDate) + 4) % 7) + 7) % 7
}

export function addDays(isoDate: string, days: number): string {
  return fromDayNumber(toDayNumber(isoDate) + days)
}

/** The canonical week-start date of the week containing `isoDate`. */
export function weekStartOf(isoDate: string): string {
  const offset = (weekdayOf(isoDate) - WEEK_START_DAY + 7) % 7
  return addDays(isoDate, -offset)
}

export function isWeekStart(isoDate: string): boolean {
  try {
    return weekStartOf(isoDate) === isoDate
  } catch {
    return false
  }
}

/** Inclusive last date of the week that starts on `weekStart`. */
export function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 6)
}

/** The 7 analytical dates of the week, in order. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}
