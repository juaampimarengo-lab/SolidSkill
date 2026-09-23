import type { Migration } from '../migrator'

/**
 * 006 — Strategy list display order. See docs/DATABASE_SCHEMA.md §5 and
 * docs/STRATEGY_ASSIGNMENT.md §8.
 *
 * `display_position` is PRESENTATION METADATA on the Strategy identity, like
 * its name: it only decides where the Strategy appears in the Strategies list.
 * It is not versioned, never creates a Draft or Version, and nothing that
 * evaluates a Trade reads it.
 *
 * Positions are dense (0..n-1) within each lifecycle section (ACTIVE /
 * ARCHIVED) and UNIQUE per section, so two strategies can never share a slot
 * and the order is always total. Existing rows are backfilled in their
 * previous effective order (created_at, id), so upgrading changes nothing a
 * user can see. The repository keeps the sections dense on create, archive,
 * restore, delete and move.
 *
 * No other table, trigger or row is touched.
 */
export const migration006: Migration = {
  version: 6,
  name: 'strategy_display_order',
  sql: `
ALTER TABLE strategies ADD COLUMN display_position INTEGER NOT NULL DEFAULT 0 CHECK (display_position >= 0);

UPDATE strategies
SET display_position = (
  SELECT COUNT(*) FROM strategies AS earlier
  WHERE earlier.status = strategies.status
    AND (earlier.created_at < strategies.created_at
         OR (earlier.created_at = strategies.created_at AND earlier.id < strategies.id))
);

CREATE UNIQUE INDEX strategies_display_position ON strategies (status, display_position);
`
}
