import type { Migration } from '../migrator'

/**
 * 002 — unique source identity for Trades. See docs/DATABASE_SCHEMA.md §15 and
 * docs/MT5_IMPORT.md §4.
 *
 * Migration 001 gave `executions` a UNIQUE source identity but left
 * `trades.source_trade_id` with a non-unique lookup index only. Idempotent
 * import needs the database itself to refuse a second Trade for the same
 * source lifecycle, so replays and concurrent/buggy importers cannot create
 * duplicates. This adds exactly that and nothing else: no column, no data
 * change. Scope is (source_platform, account_id, source_trade_id), where
 * source_trade_id is whatever the integration defines as its stable analytical
 * Trade identity — not necessarily a position id, so a future segmented Trade
 * (e.g. a netting reversal) can use its own distinct id.
 *
 * Rows with NULL source_trade_id (manually entered / not provided) are
 * unaffected. The existing non-unique trades_by_source_trade index is left in
 * place (it is now redundant but harmless; dropping it is not needed).
 */
export const migration002: Migration = {
  version: 2,
  name: 'trade_source_identity',
  sql: `
CREATE UNIQUE INDEX trades_source_identity
  ON trades (source_platform, account_id, source_trade_id)
  WHERE source_trade_id IS NOT NULL;
`
}
