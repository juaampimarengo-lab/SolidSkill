/**
 * Checkpoint 012B-4. Turns the already-proven MT5 pipeline into a SAFE,
 * AUTOMATIC reconciliation pipeline, while remaining strictly read-only
 * toward MT5. See docs/MT5_RECONCILIATION.md.
 *
 *   MT5 -> raw staging -> normalizer -> automatic idempotent reconciliation -> SQLite
 *
 * This module builds NO second Trade importer: every reconciliation run is a
 * call to the existing `importFromLiveStaging` (same normalizer, same
 * `Mt5ImportService`, same conflict/idempotency rules as the manual dev
 * gate). It only decides WHEN to call it, and does so per account,
 * serialized and debounced (`AccountReconciler`).
 *
 * History vs. live are different triggers, not different importers:
 *  - a COMPLETE history sync marks the account READY and reconciles once;
 *  - an INCOMPLETE/aborted history sync never reconciles (nothing partial is
 *    ever imported);
 *  - once READY, each accepted LIVE deal schedules a debounced reconciliation
 *    (a burst of deals converges to one run);
 *  - a disconnect cancels any pending scheduled run and clears READY (a
 *    reconnect must complete a full history sync again before live deals are
 *    trusted).
 */
import type { Database } from '../../../persistence'
import { maskLogin, type Mt5ImportResult } from '../import/mt5ImportService'
import { importFromLiveStaging, type LiveStagingSource } from '../import/liveImport'
import type { Mt5InternalEvent } from '../receiver'
import { AccountReconciler, type Scheduler } from './accountReconciler'

/** Notification the renderer may receive after a successful reconciliation. Nothing else crosses this boundary. */
export interface TradingDataChangedEvent {
  readonly accountId: string
  readonly reason: 'mt5-reconciliation'
}

export interface ReconciliationCoordinatorDeps {
  readonly getDatabase: () => Database | null
  readonly getReceiver: () => LiveStagingSource | null
  /** Masked/compact lines only — never raw identity. */
  readonly log: (message: string) => void
  readonly onDataChanged?: (event: TradingDataChangedEvent) => void
  readonly debounceMs?: number
  readonly scheduler?: Scheduler
}

/** Decodes the internal-only `accountKey` (`accountKey(server, login)` from receiver.ts) back to its parts. */
function decodeAccountKey(accountKey: string): { server: string; login: string } {
  const [server, login] = JSON.parse(accountKey) as [string, string]
  return { server, login }
}

export class Mt5ReconciliationCoordinator {
  private readonly reconcilers = new Map<string, AccountReconciler>()
  private readonly ready = new Set<string>()

  constructor(private readonly deps: ReconciliationCoordinatorDeps) {}

  /** Feed every internal bridge event here (see `Mt5InternalEvent`). Irrelevant kinds are ignored. */
  handleEvent(event: Mt5InternalEvent): void {
    switch (event.kind) {
      case 'history_end':
        if (event.status === 'complete') {
          this.ready.add(event.accountKey)
          this.reconcilerFor(event.accountKey).trigger()
        } else {
          this.deps.log(
            `MT5 reconciliation withheld for an account: history sync ${event.status} (nothing partial is ever imported)`
          )
        }
        return
      case 'deal_accepted':
        // Only LIVE deals on an already-synchronized (READY) account schedule
        // automatic reconciliation. History deals are handled exclusively via
        // the history_end('complete') trigger above.
        if (event.origin === 'live' && this.ready.has(event.accountKey)) {
          this.reconcilerFor(event.accountKey).trigger()
        }
        return
      case 'disconnected':
        this.reconcilerFor(event.accountKey).cancel()
        // A reconnect must complete a full history sync again before this
        // account's live deals are trusted to trigger reconciliation.
        this.ready.delete(event.accountKey)
        return
      default:
        return
    }
  }

  /** Test/diagnostic seam: is this account currently considered synchronized. */
  isReady(accountKey: string): boolean {
    return this.ready.has(accountKey)
  }

  private reconcilerFor(accountKey: string): AccountReconciler {
    let reconciler = this.reconcilers.get(accountKey)
    if (reconciler === undefined) {
      reconciler = new AccountReconciler({
        debounceMs: this.deps.debounceMs,
        scheduler: this.deps.scheduler,
        run: () => this.reconcileNow(accountKey),
        onError: () =>
          this.deps.log('MT5 automatic reconciliation failed unexpectedly for an account (no details logged: they may contain source identity)')
      })
      this.reconcilers.set(accountKey, reconciler)
    }
    return reconciler
  }

  private reconcileNow(accountKey: string): void {
    const db = this.deps.getDatabase()
    const receiver = this.deps.getReceiver()
    if (db === null || receiver === null) {
      this.deps.log('MT5 automatic reconciliation skipped: database or receiver unavailable')
      return
    }
    const { login } = decodeAccountKey(accountKey)
    const accountMask = maskLogin(login)
    const outcome = importFromLiveStaging(receiver, db, { accountMask })
    if (!outcome.ok) {
      this.deps.log(`MT5 automatic reconciliation refused for ${accountMask}: ${outcome.reason}: ${outcome.message}`)
      return
    }
    for (const line of outcome.summary.lines) this.deps.log(line)
    this.notifyIfChanged(outcome.summary.result)
  }

  private notifyIfChanged(result: Mt5ImportResult): void {
    if (result.created.length === 0 || result.account.accountId === null) return
    this.deps.onDataChanged?.({ accountId: result.account.accountId, reason: 'mt5-reconciliation' })
  }
}

/**
 * Starts the coordinator only for an unpackaged build with
 * SOLID_SKILL_MT5_AUTO_IMPORT=1. Otherwise returns null: the bridge and
 * history observation still work, but nothing writes automatically. Does NOT
 * require or replace the manual dev-import gate (docs/MT5_IMPORT.md §14),
 * which remains available as QA/fallback.
 */
export function createMt5ReconciliationCoordinatorFromEnvironment(
  env: NodeJS.ProcessEnv,
  isDevelopment: boolean,
  deps: ReconciliationCoordinatorDeps
): Mt5ReconciliationCoordinator | null {
  if (!isDevelopment || env['SOLID_SKILL_MT5_AUTO_IMPORT'] !== '1') return null
  return new Mt5ReconciliationCoordinator(deps)
}
