import type { Migration } from '../migrator'

/**
 * 004 — Weekly Review authored reflection. See docs/WEEKLY_REVIEW.md and
 * docs/DATABASE_SCHEMA.md §20.
 *
 * Stores ONLY what the trader wrote. Every derived number shown in Weekly
 * Review (P&L, Win Rate, trade count, compliance, Rule FAIL counts …) is
 * recomputed from persisted Trades and Rule Evaluations each time, so a
 * review row can never disagree with, or silently freeze a stale copy of, the
 * underlying facts. There is no foreign key to any Trade, Strategy Version or
 * evaluation: a review never alters them and is never altered by them.
 *
 * Identity is (account_id, week_start_date) — never a human label. The
 * week-start convention lives in src/shared/week.ts and is enforced by the
 * Review service; the column itself only checks the date shape so a future,
 * deliberate convention change stays a data migration rather than a schema
 * rewrite.
 *
 * Dedicated text columns instead of one JSON blob: each prompt is a distinct
 * product concept (forecast vs actual, repeat vs avoid …) and later
 * longitudinal analysis should be able to read them individually. '' means
 * "not written". `forecast_updated_at` records when the forecast text itself
 * last changed, so the UI can show honestly whether it was written before or
 * during the week (the forecast is not otherwise versioned in V1).
 */
export const migration004: Migration = {
  version: 4,
  name: 'weekly_reviews',
  sql: `
CREATE TABLE weekly_reviews (
  account_id          TEXT NOT NULL REFERENCES accounts (id),
  week_start_date     TEXT NOT NULL CHECK (week_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  forecast            TEXT NOT NULL DEFAULT '',
  actual              TEXT NOT NULL DEFAULT '',
  went_well           TEXT NOT NULL DEFAULT '',
  needs_improvement   TEXT NOT NULL DEFAULT '',
  repeat_next_week    TEXT NOT NULL DEFAULT '',
  avoid_next_week     TEXT NOT NULL DEFAULT '',
  next_week_focus     TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  forecast_updated_at INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY (account_id, week_start_date)
) STRICT;

-- A review's identity never changes after it is written.
CREATE TRIGGER weekly_reviews_identity_fixed
BEFORE UPDATE OF account_id, week_start_date, created_at ON weekly_reviews
BEGIN
  SELECT RAISE(ABORT, 'weekly review identity is immutable');
END;
`
}
