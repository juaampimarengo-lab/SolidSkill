import type { Migration } from '../migrator'
import { migration001 } from './001_initial_core'

/**
 * Ordered registry of every schema migration. Append only: a migration that
 * has shipped is never edited or reordered (its checksum is recorded). Add
 * the next number here, e.g. `migration002`.
 */
export const MIGRATIONS: readonly Migration[] = [migration001]
