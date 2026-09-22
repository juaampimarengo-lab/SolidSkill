import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, intOrNull, str } from '../sql'
import type { WeeklyScorecardEntry, WeeklyScorecardPatch } from '../types'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DIMENSION_PATTERN = /^[a-z_]{1,40}$/

function toEntry(row: Row): WeeklyScorecardEntry {
  return {
    accountId: str(row['account_id']),
    weekStartDate: str(row['week_start_date']),
    dimension: str(row['dimension']),
    score: intOrNull(row['score']),
    note: str(row['note']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

/**
 * Weekly Scorecard self-assessment (migration 005). Notes are stored exactly
 * as given — never trimmed or translated. This table is separate from
 * `weekly_reviews`, so nothing here can touch the authored reflection, and
 * nothing here reads or writes Trades or evaluations.
 */
export class WeeklyScorecardRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  /** Stored entries of one (account, week), in dimension-key order. Unrated dimensions may be absent. */
  list(accountId: string, weekStartDate: string): WeeklyScorecardEntry[] {
    return this.sql
      .all('SELECT * FROM weekly_scorecard_entries WHERE account_id = ? AND week_start_date = ? ORDER BY dimension', [
        accountId,
        weekStartDate
      ])
      .map(toEntry)
  }

  /**
   * Upserts the given dimensions. Within each, only the parts present in the
   * patch are written (score and note are independent); dimensions absent
   * from `patches` are untouched. Runs in one transaction.
   */
  save(accountId: string, weekStartDate: string, patches: Readonly<Record<string, WeeklyScorecardPatch>>): WeeklyScorecardEntry[] {
    if (!DATE_PATTERN.test(weekStartDate)) throw new Error(`Invalid week start date: ${weekStartDate}`)
    return this.sql.transaction(() => {
      const at = BigInt(this.now())
      for (const [dimension, patch] of Object.entries(patches)) {
        if (!DIMENSION_PATTERN.test(dimension)) throw new Error(`Invalid scorecard dimension: ${dimension}`)
        this.sql.run(
          `INSERT INTO weekly_scorecard_entries (account_id, week_start_date, dimension, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (account_id, week_start_date, dimension) DO NOTHING`,
          [accountId, weekStartDate, dimension, at, at]
        )
        const sets: string[] = ['updated_at = ?']
        const params: (string | bigint | null)[] = [at]
        if (patch.score !== undefined) {
          sets.push('score = ?')
          params.push(patch.score === null ? null : BigInt(patch.score))
        }
        if (patch.note !== undefined) {
          sets.push('note = ?')
          params.push(patch.note)
        }
        this.sql.run(
          `UPDATE weekly_scorecard_entries SET ${sets.join(', ')} WHERE account_id = ? AND week_start_date = ? AND dimension = ?`,
          [...params, accountId, weekStartDate, dimension]
        )
      }
      return this.list(accountId, weekStartDate)
    })
  }

  /** Week starts of this account with any score or non-blank note, newest first. */
  listAuthoredWeeks(accountId: string): string[] {
    return this.sql
      .all(
        `SELECT DISTINCT week_start_date FROM weekly_scorecard_entries
         WHERE account_id = ? AND (score IS NOT NULL OR trim(note, ' ' || char(9, 10, 13)) <> '')
         ORDER BY week_start_date DESC`,
        [accountId]
      )
      .map((row) => str(row['week_start_date']))
  }
}
