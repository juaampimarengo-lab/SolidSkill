import type { Migration } from '../migrator'
import { migration001 } from './001_initial_core'
import { migration002 } from './002_trade_source_identity'
import { migration003 } from './003_trade_media'
import { migration004 } from './004_weekly_reviews'
import { migration005 } from './005_weekly_scorecard'
import { migration006 } from './006_strategy_display_order'

/**
 * Ordered registry of every schema migration. Append only: a migration that
 * has shipped is never edited or reordered (its checksum is recorded). Add
 * the next number here.
 */
export const MIGRATIONS: readonly Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006]
