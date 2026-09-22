import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, intOrNull, str } from '../sql'
import type { WeeklyReview, WeeklyReviewFields } from '../types'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Field name ↔ column. The only columns a review write may touch. */
const COLUMNS: Record<keyof WeeklyReviewFields, string> = {
  forecast: 'forecast',
  actual: 'actual',
  wentWell: 'went_well',
  needsImprovement: 'needs_improvement',
  repeatNextWeek: 'repeat_next_week',
  avoidNextWeek: 'avoid_next_week',
  nextWeekFocus: 'next_week_focus',
  notes: 'notes'
}

export const WEEKLY_REVIEW_FIELDS = Object.keys(COLUMNS) as (keyof WeeklyReviewFields)[]

function toReview(row: Row): WeeklyReview {
  return {
    accountId: str(row['account_id']),
    weekStartDate: str(row['week_start_date']),
    forecast: str(row['forecast']),
    actual: str(row['actual']),
    wentWell: str(row['went_well']),
    needsImprovement: str(row['needs_improvement']),
    repeatNextWeek: str(row['repeat_next_week']),
    avoidNextWeek: str(row['avoid_next_week']),
    nextWeekFocus: str(row['next_week_focus']),
    notes: str(row['notes']),
    forecastUpdatedAt: intOrNull(row['forecast_updated_at']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

/**
 * Weekly Review authored reflection (migration 004). Text is stored exactly as
 * given — never trimmed, normalized or translated. No derived metric is ever
 * written here, and nothing here reads or writes Trades or evaluations.
 */
export class WeeklyReviewRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  get(accountId: string, weekStartDate: string): WeeklyReview | null {
    const row = this.sql.get('SELECT * FROM weekly_reviews WHERE account_id = ? AND week_start_date = ?', [
      accountId,
      weekStartDate
    ])
    return row === undefined ? null : toReview(row)
  }

  /**
   * Upserts only the fields present in `patch`; absent fields keep their
   * stored text. `forecast_updated_at` moves only when the forecast text
   * actually changes.
   */
  save(accountId: string, weekStartDate: string, patch: Partial<WeeklyReviewFields>): WeeklyReview {
    if (!DATE_PATTERN.test(weekStartDate)) throw new Error(`Invalid week start date: ${weekStartDate}`)
    return this.sql.transaction(() => {
      const at = this.now()
      const existing = this.get(accountId, weekStartDate)
      if (existing === null) {
        this.sql.run(
          `INSERT INTO weekly_reviews (account_id, week_start_date, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          [accountId, weekStartDate, BigInt(at), BigInt(at)]
        )
      }
      const sets: string[] = ['updated_at = ?']
      const params: (string | bigint | null)[] = [BigInt(at)]
      for (const field of WEEKLY_REVIEW_FIELDS) {
        const value = patch[field]
        if (value === undefined) continue
        sets.push(`${COLUMNS[field]} = ?`)
        params.push(value)
      }
      const forecastChanged = patch.forecast !== undefined && patch.forecast !== (existing?.forecast ?? '')
      if (forecastChanged) {
        sets.push('forecast_updated_at = ?')
        params.push(BigInt(at))
      }
      this.sql.run(`UPDATE weekly_reviews SET ${sets.join(', ')} WHERE account_id = ? AND week_start_date = ?`, [
        ...params,
        accountId,
        weekStartDate
      ])
      const saved = this.get(accountId, weekStartDate)
      if (saved === null) throw new Error(`Weekly review missing after save: ${accountId} ${weekStartDate}`)
      return saved
    })
  }

  /** Week starts of this account whose review has any written text, newest first. */
  listAuthoredWeeks(accountId: string): string[] {
    // SQLite's one-argument trim() strips spaces only; tabs/newlines must count as blank too.
    const anyText = WEEKLY_REVIEW_FIELDS.map((f) => `trim(${COLUMNS[f]}, ' ' || char(9, 10, 13)) <> ''`).join(' OR ')
    return this.sql
      .all(
        `SELECT week_start_date FROM weekly_reviews WHERE account_id = ? AND (${anyText}) ORDER BY week_start_date DESC`,
        [accountId]
      )
      .map((row) => str(row['week_start_date']))
  }
}
