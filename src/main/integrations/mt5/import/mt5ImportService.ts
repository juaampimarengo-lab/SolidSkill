/**
 * MT5 Import Service (Checkpoint 012B-2). See docs/MT5_IMPORT.md.
 *
 * Maps ONLY proven COMPLETED lifecycle candidates from the pure normalizer
 * into persisted Account / Trade / Executions, idempotently. Everything else
 * (open, unresolved, unsupported, rejected, non-trading) is reported, never
 * persisted.
 *
 * READ-ONLY toward MT5: this module receives already-normalized facts. It has
 * no connection to MT5 and no capability to send anything to it.
 *
 * Layering: depends on the normalizer's OUTPUT TYPES and the persistence
 * facade only. The normalizer never sees SQLite; persistence never sees MT5.
 * No methodology or strategy concept exists here: imported Trades start with
 * no Strategy, no Rule Evaluations and no Notes.
 */
import { decimalToScaled, decimalToScaledOrNull } from '../../../persistence/fixedPoint'
import type { Database, Execution, NewExecution, NewTrade, Trade } from '../../../persistence'
import type { CompletedTradeCandidate, Mt5NormalizationResult, NormalizedExecution, UnresolvedReason } from '../normalizer'

export const MT5_PLATFORM = 'MT5'

/** Unresolved reasons that mean "a construct the importer deliberately does not support yet". */
const UNSUPPORTED_REASONS: ReadonlySet<UnresolvedReason> = new Set<UnresolvedReason>([
  'INOUT_NOT_PRODUCTION_PROVEN',
  'OUT_BY_UNSUPPORTED',
  'UNSUPPORTED_DEAL_ENTRY'
])

export interface Mt5ImportOptions {
  /** ISO 4217 code of the account currency (not carried by a raw snapshot; supplied by the caller). */
  readonly currency: string
  /** Report what would happen; perform NO writes (not even the Account). */
  readonly dryRun?: boolean
}

export interface ImportedLifecycleRef {
  readonly sourcePositionId: string
  /** null in a dry run for lifecycles that would be created. */
  readonly tradeId: string | null
  readonly executionCount: number
}

export interface ImportConflict {
  readonly sourcePositionId: string
  readonly tradeId: string | null
  /** Names of the source facts that differ (never their values). */
  readonly differences: readonly string[]
}

export interface ImportFailure {
  readonly sourcePositionId: string
  readonly reason: 'INCOHERENT_CANDIDATE' | 'WRITE_FAILED'
  readonly message: string
}

export interface SkippedLifecycle {
  readonly sourcePositionId: string
  readonly reasons: readonly UnresolvedReason[]
}

export interface Mt5ImportResult {
  readonly dryRun: boolean
  readonly account: {
    /** 'not-needed' = there was nothing importable, so no Account was created or required. */
    readonly action: 'created' | 'reused' | 'would-create' | 'not-needed'
    readonly accountId: string | null
    readonly displayName: string
    /** Masked source identity, e.g. "***514". Never the full login. */
    readonly maskedLogin: string
  }
  /** Created (or, in a dry run, WOULD be created). */
  readonly created: readonly ImportedLifecycleRef[]
  readonly alreadyExisting: readonly ImportedLifecycleRef[]
  readonly conflicts: readonly ImportConflict[]
  readonly skippedOpen: readonly SkippedLifecycle[]
  readonly skippedUnresolved: readonly SkippedLifecycle[]
  readonly skippedUnsupported: readonly SkippedLifecycle[]
  readonly failed: readonly ImportFailure[]
  /** Non-trading deals (BALANCE, CREDIT, ...) and foreign-account deals: never Trades. */
  readonly ignoredNonTrading: number
  readonly rejectedDeals: number
  /** Completed candidates whose average price could not be represented exactly at scale 8. */
  readonly inexactAverages: number
  readonly totals: { readonly completedCandidates: number; readonly executionsCreated: number }
}

// ---------------------------------------------------------------------------
// Identity, masking, analytical date
// ---------------------------------------------------------------------------

/** Stable source identity of a real MT5 account. Platform facts only: server + login. */
export function mt5SourceAccountId(server: string, accountLogin: string): string {
  return JSON.stringify([server, accountLogin])
}

/** "***514": the last three characters only; shorter logins are fully masked. */
export function maskLogin(accountLogin: string): string {
  return accountLogin.length >= 6 ? `***${accountLogin.slice(-3)}` : '***'
}

/** Deterministic neutral display name from safe metadata. No broker/prop-firm inference. */
export function mt5AccountDisplayName(accountLogin: string): string {
  return `MT5 · ${maskLogin(accountLogin)}`
}

/**
 * V1 analytical-date policy (docs/MT5_IMPORT.md §10): the calendar date of the
 * lifecycle's OPENING deal, read from DEAL_TIME_MSC as reported (broker server
 * time) using explicit UTC accessors. Never the machine-local timezone; no
 * broker UTC offset is assumed because MT5 does not supply one.
 */
export function mt5AnalyticalDate(openedAtMsc: number): string {
  return new Date(openedAtMsc).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Candidate -> persistence input
// ---------------------------------------------------------------------------

function toNewExecution(e: NormalizedExecution): NewExecution {
  return {
    sourceExecutionId: e.sourceExecutionKey,
    sourcePositionId: e.positionId,
    executedAt: e.executedAtMsc,
    side: e.side,
    quantity: e.quantity,
    price: e.price,
    commission: e.commission,
    fees: e.fees,
    swap: e.swap
  }
}

function toNewTrade(candidate: CompletedTradeCandidate, accountId: string): NewTrade {
  return {
    accountId,
    sourceTradeId: candidate.sourceLifecycleKey,
    sourcePositionId: candidate.sourcePositionId,
    analyticalTradeDate: mt5AnalyticalDate(candidate.openedAtMsc),
    // The symbol exactly as MT5 reported it (broker suffixes included).
    instrument: candidate.symbol,
    // The normalizer's direction, from the OPENING deal. Never recomputed here.
    direction: candidate.direction,
    quantity: candidate.openedQuantity,
    openedAt: candidate.openedAtMsc,
    closedAt: candidate.closedAtMsc,
    avgEntryPrice: candidate.avgEntryPrice,
    avgExitPrice: candidate.avgExitPrice,
    grossPnl: candidate.grossPnl,
    commission: candidate.commission,
    fees: candidate.fees,
    swap: candidate.swap,
    netPnl: candidate.netPnl,
    executions: [...candidate.executions].sort((a, b) => a.sequence - b.sequence).map(toNewExecution)
  }
}

function sumNullable(values: readonly (string | null)[]): bigint | null {
  let total: bigint | null = null
  for (const v of values) if (v !== null) total = (total ?? 0n) + decimalToScaled(v)
  return total
}

/** Returns a problem description, or null when the candidate is internally coherent. */
function incoherence(c: CompletedTradeCandidate): string | null {
  try {
    if (c.executions.length === 0) return 'no executions'
    if (!Number.isSafeInteger(c.openedAtMsc) || !Number.isSafeInteger(c.closedAtMsc)) return 'invalid timestamps'
    if (c.closedAtMsc < c.openedAtMsc) return 'closed before opened'
    const opened = decimalToScaled(c.openedQuantity)
    if (opened <= 0n) return 'non-positive quantity'
    if (decimalToScaled(c.remainingQuantity) !== 0n) return 'lifecycle is not fully closed'
    const entrySide = c.direction === 'LONG' ? 'BUY' : 'SELL'
    let entryQty = 0n
    let exitQty = 0n
    for (const e of c.executions) {
      if (e.role === 'ENTRY') {
        if (e.side !== entrySide) return 'entry execution side contradicts the trade direction'
        entryQty += decimalToScaled(e.quantity)
      } else {
        if (e.side === entrySide) return 'exit execution side contradicts the trade direction'
        exitQty += decimalToScaled(e.quantity)
      }
    }
    if (entryQty !== opened || exitQty !== opened) return 'execution quantities do not add up to the trade quantity'
    const categories = ['commission', 'fees', 'swap'] as const
    for (const key of categories) {
      const fromExecutions = sumNullable(c.executions.map((e) => e[key]))
      if (fromExecutions !== decimalToScaledOrNull(c[key])) return `${key} does not equal the sum of its executions`
    }
    const gross = decimalToScaledOrNull(c.grossPnl)
    const net = decimalToScaledOrNull(c.netPnl)
    if (gross === null) {
      if (net !== null) return 'net P&L present without gross P&L'
    } else {
      const expected =
        gross + (decimalToScaledOrNull(c.commission) ?? 0n) + (decimalToScaledOrNull(c.fees) ?? 0n) + (decimalToScaledOrNull(c.swap) ?? 0n)
      if (net !== expected) return 'net P&L does not equal gross + commission + fees + swap'
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid value'
  }
}

// ---------------------------------------------------------------------------
// Conflict detection (source facts only; never overwrites)
// ---------------------------------------------------------------------------

const eqScaled = (a: string | null, b: string | null): boolean => decimalToScaledOrNull(a) === decimalToScaledOrNull(b)

function tradeDifferences(existing: Trade, expected: NewTrade): string[] {
  const d: string[] = []
  if (existing.instrument !== expected.instrument) d.push('instrument')
  if (existing.direction !== expected.direction) d.push('direction')
  if (existing.sourcePositionId !== (expected.sourcePositionId ?? null)) d.push('sourcePositionId')
  if (!eqScaled(existing.quantity, expected.quantity)) d.push('quantity')
  if (existing.openedAt !== expected.openedAt) d.push('openedAt')
  if (existing.closedAt !== (expected.closedAt ?? null)) d.push('closedAt')
  if (!eqScaled(existing.avgEntryPrice, expected.avgEntryPrice)) d.push('avgEntryPrice')
  if (!eqScaled(existing.avgExitPrice, expected.avgExitPrice ?? null)) d.push('avgExitPrice')
  if (!eqScaled(existing.grossPnl, expected.grossPnl ?? null)) d.push('grossPnl')
  if (!eqScaled(existing.commission, expected.commission ?? null)) d.push('commission')
  if (!eqScaled(existing.fees, expected.fees ?? null)) d.push('fees')
  if (!eqScaled(existing.swap, expected.swap ?? null)) d.push('swap')
  if (!eqScaled(existing.netPnl, expected.netPnl ?? null)) d.push('netPnl')
  return d
}

function executionDifferences(existing: readonly Execution[], expected: readonly NewExecution[]): string[] {
  if (existing.length !== expected.length) return ['executionCount']
  const byKey = new Map(existing.map((e) => [e.sourceExecutionId, e]))
  const d = new Set<string>()
  for (const want of expected) {
    const have = want.sourceExecutionId === undefined || want.sourceExecutionId === null ? undefined : byKey.get(want.sourceExecutionId)
    if (have === undefined) {
      d.add('executionSet')
      continue
    }
    if (have.side !== want.side) d.add('execution.side')
    if (have.executedAt !== want.executedAt) d.add('execution.executedAt')
    if (have.sourcePositionId !== (want.sourcePositionId ?? null)) d.add('execution.sourcePositionId')
    if (!eqScaled(have.quantity, want.quantity)) d.add('execution.quantity')
    if (!eqScaled(have.price, want.price)) d.add('execution.price')
    if (!eqScaled(have.commission, want.commission ?? null)) d.add('execution.commission')
    if (!eqScaled(have.fees, want.fees ?? null)) d.add('execution.fees')
    if (!eqScaled(have.swap, want.swap ?? null)) d.add('execution.swap')
  }
  return [...d]
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: 'created' | 'existing'; tradeId: string | null }
  | { kind: 'conflict'; tradeId: string | null; differences: string[] }

export class Mt5ImportService {
  constructor(private readonly db: Database) {}

  /**
   * Imports the COMPLETED candidates of one normalization result.
   *
   * Transaction boundary: one transaction PER LIFECYCLE (Trade + all its
   * Executions together, or nothing). A malformed or failing lifecycle rolls
   * back alone and is reported in `failed`; it can neither corrupt nor block
   * previously imported history or its siblings.
   */
  import(result: Mt5NormalizationResult, options: Mt5ImportOptions): Mt5ImportResult {
    const dryRun = options.dryRun === true
    const { server, accountLogin } = result.account
    const sourceAccountId = mt5SourceAccountId(server, accountLogin)
    const displayName = mt5AccountDisplayName(accountLogin)
    const { accounts, trades } = this.db.repositories

    const created: ImportedLifecycleRef[] = []
    const alreadyExisting: ImportedLifecycleRef[] = []
    const conflicts: ImportConflict[] = []
    const failed: ImportFailure[] = []
    let inexactAverages = 0
    let executionsCreated = 0

    // Account: only when there is something to import. Created once per real source account.
    let accountId: string | null = null
    let accountAction: Mt5ImportResult['account']['action'] = 'not-needed'
    if (result.completed.length > 0) {
      const existing = accounts.findBySource(MT5_PLATFORM, sourceAccountId)
      if (existing !== null) {
        accountId = existing.id
        accountAction = 'reused'
      } else if (dryRun) {
        accountAction = 'would-create'
      } else {
        accountId = this.db.transaction(() => {
          const again = accounts.findBySource(MT5_PLATFORM, sourceAccountId)
          if (again !== null) return again.id
          return accounts.create({
            displayName,
            sourcePlatform: MT5_PLATFORM,
            sourceAccountId,
            currency: options.currency,
            timezone: null // unknown: MT5 supplies no trading timezone; the UI presents it as UTC.
          }).id
        })
        accountAction = 'created'
      }
    }

    for (const candidate of result.completed) {
      const ref = (tradeId: string | null): ImportedLifecycleRef => ({
        sourcePositionId: candidate.sourcePositionId,
        tradeId,
        executionCount: candidate.executions.length
      })

      const problem = incoherence(candidate)
      if (problem !== null) {
        failed.push({ sourcePositionId: candidate.sourcePositionId, reason: 'INCOHERENT_CANDIDATE', message: problem })
        continue
      }
      if (candidate.avgEntryPriceExact === false || candidate.avgExitPriceExact === false) inexactAverages += 1

      try {
        const outcome = this.db.transaction((): Outcome => {
          if (accountId === null) {
            // Dry run and no Account yet: nothing can already exist.
            return { kind: 'created', tradeId: null }
          }
          const expected = toNewTrade(candidate, accountId)
          const found = trades.findBySourceTradeId(MT5_PLATFORM, accountId, candidate.sourceLifecycleKey)
          if (found !== null) {
            const differences = [
              ...tradeDifferences(found, expected),
              ...executionDifferences(trades.listExecutions(found.id), expected.executions)
            ]
            return differences.length === 0
              ? { kind: 'existing', tradeId: found.id }
              : { kind: 'conflict', tradeId: found.id, differences }
          }
          // No Trade with this identity, but one of its deals may already belong to another Trade.
          const stolen = expected.executions.some(
            (e) =>
              e.sourceExecutionId !== undefined &&
              e.sourceExecutionId !== null &&
              trades.findExecutionBySourceId(MT5_PLATFORM, accountId as string, e.sourceExecutionId) !== null
          )
          if (stolen) return { kind: 'conflict', tradeId: null, differences: ['executionOwnedByAnotherTrade'] }
          if (dryRun) return { kind: 'created', tradeId: null }
          return { kind: 'created', tradeId: trades.createTrade(expected).id }
        })

        if (outcome.kind === 'created') {
          created.push(ref(outcome.tradeId))
          executionsCreated += candidate.executions.length
        } else if (outcome.kind === 'existing') {
          alreadyExisting.push(ref(outcome.tradeId))
        } else if (outcome.kind === 'conflict') {
          conflicts.push({
            sourcePositionId: candidate.sourcePositionId,
            tradeId: outcome.tradeId,
            differences: outcome.differences
          })
        }
      } catch (error) {
        // The lifecycle's transaction rolled back: no half-Trade remains.
        failed.push({
          sourcePositionId: candidate.sourcePositionId,
          reason: 'WRITE_FAILED',
          message: error instanceof Error ? error.message : 'unknown write failure'
        })
      }
    }

    const skippedUnresolved: SkippedLifecycle[] = []
    const skippedUnsupported: SkippedLifecycle[] = []
    for (const u of result.unresolved) {
      const entry: SkippedLifecycle = { sourcePositionId: u.sourcePositionId, reasons: u.reasons }
      // A lifecycle with any unsupported construct is reported as unsupported.
      if (u.reasons.some((r) => UNSUPPORTED_REASONS.has(r))) skippedUnsupported.push(entry)
      else skippedUnresolved.push(entry)
    }

    return {
      dryRun,
      account: { action: accountAction, accountId, displayName, maskedLogin: maskLogin(accountLogin) },
      created,
      alreadyExisting,
      conflicts,
      skippedOpen: result.open.map((o) => ({ sourcePositionId: o.sourcePositionId, reasons: [] })),
      skippedUnresolved,
      skippedUnsupported,
      failed,
      ignoredNonTrading: result.ignored.length,
      rejectedDeals: result.rejected.length,
      inexactAverages,
      totals: { completedCandidates: result.completed.length, executionsCreated }
    }
  }
}

/** Compact, non-sensitive one-paragraph summary (counts + masked account; no tickets or prices). */
export function describeImportResult(r: Mt5ImportResult): string {
  return (
    `MT5 import ${r.dryRun ? '(DRY RUN, nothing written) ' : ''}account ${r.account.maskedLogin}: ` +
    `account ${r.account.action}; created ${r.created.length}, already existing ${r.alreadyExisting.length}, ` +
    `conflicts ${r.conflicts.length}, failed ${r.failed.length}; skipped open ${r.skippedOpen.length}, ` +
    `unresolved ${r.skippedUnresolved.length}, unsupported ${r.skippedUnsupported.length}; ` +
    `ignored non-trading ${r.ignoredNonTrading}, rejected deals ${r.rejectedDeals}`
  )
}

