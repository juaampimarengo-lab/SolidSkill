/**
 * Live-staging import (Checkpoint 012B-2 final gate). See docs/MT5_IMPORT.md §14.
 *
 * Source of truth for the first REAL write: the in-memory receiver staging and
 * the validated hello metadata of the connected EA (real server + login +
 * currency), NOT the pseudonymized dev snapshot. Pure orchestration:
 *
 *   hello metadata + staged raw deals -> pure normalizer -> Mt5ImportService -> SQLite
 *
 * Read-only toward MT5. No raw history is persisted anywhere. Real identity is
 * used internally only; every string returned from here is masked.
 */
import { basename, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { Database } from '../../../persistence'
import type { Mt5AccountStatus, Mt5ReceiverStatus } from '../receiver'
import type { StagedDeal } from '../rawDealStaging'
import { normalizeMt5Deals } from '../normalizer'
import { buildPersistedReport } from './importReport'
import { MT5_PLATFORM, Mt5ImportService, maskLogin, mt5SourceAccountId, type Mt5ImportResult } from './mt5ImportService'

export const DEV_PROFILE_DIR = 'solid-skill-dev'

/** The narrow, read-only view of the receiver this module needs (Mt5Receiver satisfies it). */
export interface LiveStagingSource {
  getStatus(): Mt5ReceiverStatus
  getStagedDeals(): readonly StagedDeal[]
}

/**
 * The real write may only target the development profile (userData dir named
 * `solid-skill-dev`), a throwaway temp path, or an in-memory database (tests).
 * Any other path - notably the production-named profile - is refused.
 */
export function isDevelopmentDatabasePath(path: string): boolean {
  if (path === ':memory:') return true
  const full = resolve(path)
  if (basename(dirname(full)) === DEV_PROFILE_DIR) return true
  return full.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())
}

export type LiveImportRefusal =
  | 'NOT_DEVELOPMENT_DATABASE'
  | 'NO_MT5_ACCOUNT'
  | 'ACCOUNT_AMBIGUOUS'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_CONNECTED'
  | 'CURRENCY_INVALID'
  | 'ACCOUNTING_MODE_UNKNOWN'
  | 'HISTORY_SYNC_NOT_COMPLETE'
  | 'NO_STAGED_DEALS'

export interface LiveImportSummary {
  readonly account: { readonly masked: string; readonly currency: string; readonly action: Mt5ImportResult['account']['action'] }
  readonly rawDealsStaged: number
  readonly before: { readonly accountExists: boolean; readonly trades: number; readonly executions: number }
  readonly after: { readonly trades: number; readonly executions: number }
  readonly result: Mt5ImportResult
  /** Masked, human-readable summary lines (also safe to log). */
  readonly lines: readonly string[]
}

export type LiveImportOutcome =
  | { readonly ok: true; readonly summary: LiveImportSummary }
  | { readonly ok: false; readonly reason: LiveImportRefusal; readonly message: string }

const refuse = (reason: LiveImportRefusal, message: string): LiveImportOutcome => ({ ok: false, reason, message })

function countFor(db: Database, accountId: string | null): { trades: number; executions: number } {
  if (accountId === null) return { trades: 0, executions: 0 }
  const { trades } = db.repositories
  const own = trades.list({ accountId })
  let executions = 0
  for (const t of own) executions += trades.listExecutions(t.id).length
  return { trades: own.length, executions }
}

/**
 * Normalizes the CURRENT receiver staging for one connected account and imports
 * its supported completed lifecycles. Repeatable: a second run against the same
 * staging creates nothing.
 *
 * @param accountMask masked login (e.g. "***514") to choose among several
 *   connected accounts; optional when exactly one is present.
 */
export function importFromLiveStaging(
  source: LiveStagingSource,
  db: Database,
  options: { readonly accountMask?: string } = {}
): LiveImportOutcome {
  if (!isDevelopmentDatabasePath(db.health.path)) {
    return refuse('NOT_DEVELOPMENT_DATABASE', `refusing to write: target database is not the ${DEV_PROFILE_DIR} development profile`)
  }
  const status = source.getStatus()
  const candidates: readonly Mt5AccountStatus[] =
    options.accountMask === undefined ? status.accounts : status.accounts.filter((a) => maskLogin(a.login) === options.accountMask)
  if (status.accounts.length === 0) return refuse('NO_MT5_ACCOUNT', 'no MT5 account has completed hello: connect the EA first')
  if (candidates.length === 0) return refuse('ACCOUNT_NOT_FOUND', 'no connected MT5 account matches the requested masked identity')
  if (candidates.length > 1) {
    return refuse('ACCOUNT_AMBIGUOUS', `several MT5 accounts are staged (${candidates.map((a) => maskLogin(a.login)).join(', ')}): choose one by masked identity`)
  }
  const account = candidates[0] as Mt5AccountStatus
  const masked = maskLogin(account.login)
  if (!account.connected) return refuse('ACCOUNT_NOT_CONNECTED', `MT5 account ${masked} is not currently connected`)
  // The currency comes ONLY from the validated hello. Missing/invalid: refuse, never guess.
  if (!/^[A-Z]{3}$/.test(account.currency)) {
    return refuse('CURRENCY_INVALID', `MT5 account ${masked} reported no valid ISO currency in hello; refusing to guess`)
  }
  if (account.positionAccounting === null) {
    return refuse('ACCOUNTING_MODE_UNKNOWN', `MT5 account ${masked} reported an unknown position-accounting mode`)
  }
  if (account.lastSync === null || account.lastSync.status !== 'complete') {
    return refuse('HISTORY_SYNC_NOT_COMPLETE', `MT5 account ${masked}: history sync has not completed (import only after a complete sync)`)
  }
  const deals = source
    .getStagedDeals()
    .map((s) => s.deal)
    .filter((d) => d.server === account.server && d.accountLogin === account.login)
  if (deals.length === 0) return refuse('NO_STAGED_DEALS', `MT5 account ${masked}: no raw deals are staged`)

  const existing = db.repositories.accounts.findBySource(MT5_PLATFORM, mt5SourceAccountId(account.server, account.login))
  const before = countFor(db, existing?.id ?? null)

  const normalized = normalizeMt5Deals(deals, {
    server: account.server,
    accountLogin: account.login,
    accounting: account.positionAccounting
  })
  const result = new Mt5ImportService(db).import(normalized, { currency: account.currency })
  const after = countFor(db, result.account.accountId)

  const lines = [
    `MT5 live-staging import, account ${masked}, currency ${account.currency} (from hello)`,
    `  target: development database`,
    `  account: ${result.account.action}${existing === null ? '' : ' (existing)'}`,
    `  raw deals staged: ${deals.length}; completed candidates: ${result.totals.completedCandidates}`,
    `  before: ${before.trades} trades, ${before.executions} executions`,
    `  created Trades: ${result.created.length}; already-existing Trades: ${result.alreadyExisting.length}; created Executions: ${result.totals.executionsCreated}`,
    `  skipped: open ${result.skippedOpen.length}, unresolved ${result.skippedUnresolved.length}, unsupported ${result.skippedUnsupported.length}; ignored non-trading ${result.ignoredNonTrading}`,
    `  conflicts: ${result.conflicts.length}; failures: ${result.failed.length}`,
    `  after: ${after.trades} trades, ${after.executions} executions`,
    ...result.conflicts.map((c) => `  CONFLICT position ${c.sourcePositionId}: ${c.differences.join(', ')}`),
    ...result.failed.map((f) => `  FAILED position ${f.sourcePositionId}: ${f.reason}`),
    ...buildPersistedReport(db, masked)
  ]
  return {
    ok: true,
    summary: {
      account: { masked, currency: account.currency, action: result.account.action },
      rawDealsStaged: deals.length,
      before: { accountExists: existing !== null, ...before },
      after,
      result,
      lines
    }
  }
}
