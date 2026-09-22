import type { Migration } from '../migrator'

/**
 * 005 — Weekly Scorecard. See docs/WEEKLY_REVIEW.md §12a and
 * docs/DATABASE_SCHEMA.md §21.
 *
 * The trader's own 1–5 self-assessment of one (account, week) on a small set
 * of generic process dimensions, each with an optional short note. One row per
 * (account, week, dimension) rather than six columns on `weekly_reviews`:
 *
 *  - a scorecard save can never overwrite the authored reflection text of
 *    migration 004 (different table, different write path);
 *  - a dimension added later is new rows, not a schema change.
 *
 * The dimension column only checks the key's shape; the set of accepted keys
 * is enforced by the Review service (src/shared/ipc/reviews.ts). The keys are
 * generic self-assessment dimensions, never a trading-methodology concept.
 *
 * Like migration 004 this stores ONLY what the trader entered: no derived
 * metric, no foreign key to a Trade, Strategy Version or evaluation. A row
 * with score NULL and note '' is equivalent to "not rated".
 */
export const migration005: Migration = {
  version: 5,
  name: 'weekly_scorecard',
  sql: `
CREATE TABLE weekly_scorecard_entries (
  account_id      TEXT NOT NULL REFERENCES accounts (id),
  week_start_date TEXT NOT NULL CHECK (week_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  dimension       TEXT NOT NULL CHECK (length(dimension) BETWEEN 1 AND 40 AND dimension NOT GLOB '*[^a-z_]*'),
  score           INTEGER CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  note            TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (account_id, week_start_date, dimension)
) STRICT;

-- An entry's identity never changes after it is written.
CREATE TRIGGER weekly_scorecard_identity_fixed
BEFORE UPDATE OF account_id, week_start_date, dimension, created_at ON weekly_scorecard_entries
BEGIN
  SELECT RAISE(ABORT, 'weekly scorecard identity is immutable');
END;
`
}
