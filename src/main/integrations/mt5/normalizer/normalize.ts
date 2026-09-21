/**
 * MT5 raw deals -> lifecycle candidates. PURE and DETERMINISTIC: no I/O, no
 * SQLite, no Electron, no clock, no randomness. Same deal SET (any arrival
 * order) -> byte-identical result. See docs/MT5_NORMALIZATION.md.
 *
 * Invariants enforced here:
 *  - Direction comes ONLY from the opening (DEAL_ENTRY_IN) deal side. A closing
 *    deal's side never decides direction.
 *  - The unit of reconstruction is DEAL_POSITION_ID, never the symbol.
 *  - Anything not provable from the raw facts (INOUT, OUT_BY, cancelled deals,
 *    unknown types/entries, inconsistent sequences) is returned as an explicit
 *    unresolved/rejected result. Nothing is guessed, nothing is forced.
 *  - No methodology, strategy, or setup concept exists at this layer.
 */
import { decimalToScaled, scaledToDecimal } from '../../../persistence/fixedPoint'
import { dealTypeLabel, type RawMt5Deal } from '../protocol'
import { rawDealIdentity } from '../rawDealStaging'
import type {
  CompletedTradeCandidate,
  IgnoredDeal,
  InoutObservation,
  Mt5AccountContext,
  Mt5ExecutionRole,
  Mt5ExecutionSide,
  Mt5NormalizationResult,
  Mt5TradeDirection,
  NormalizationDiagnostic,
  NormalizedExecution,
  OpenLifecycleCandidate,
  RejectedDeal,
  RejectedReason,
  UnresolvedLifecycle,
  UnresolvedReason
} from './types'

const DEAL_TYPE_BUY = 0
const DEAL_TYPE_SELL = 1
const DEAL_TYPE_BUY_CANCELED = 13
const DEAL_TYPE_SELL_CANCELED = 14
const ENTRY_IN = 0
const ENTRY_INOUT = 2
const ENTRY_OUT_BY = 3

/** Ordered key JSON so two structurally equal deals compare equal regardless of key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Canonical chronological order: timeMsc, then numeric deal ticket. Arrival order is never consulted. */
export function compareDealsCanonically(a: RawMt5Deal, b: RawMt5Deal): number {
  if (a.timeMsc !== b.timeMsc) return a.timeMsc < b.timeMsc ? -1 : 1
  const ta = BigInt(a.dealTicket)
  const tb = BigInt(b.dealTicket)
  return ta === tb ? 0 : ta < tb ? -1 : 1
}

export function sourceLifecycleKey(server: string, accountLogin: string, positionId: string): string {
  return JSON.stringify(['MT5', server, accountLogin, positionId])
}

// ---------------------------------------------------------------------------
// Exact arithmetic (scale 8 bigint)
// ---------------------------------------------------------------------------

function sumNullable(values: readonly (bigint | null)[]): bigint | null {
  let total: bigint | null = null
  for (const v of values) if (v !== null) total = (total ?? 0n) + v
  return total
}

/** sum(q*p)/sum(q) at scale 8, rounded half-up; exact=false when rounding occurred. */
function weightedAverage(parts: readonly { q: bigint; p: bigint }[]): { value: bigint; exact: boolean } {
  let notional = 0n // scale 16
  let quantity = 0n // scale 8
  for (const { q, p } of parts) {
    notional += q * p
    quantity += q
  }
  const value = (2n * notional + quantity) / (2n * quantity)
  return { value, exact: notional % quantity === 0n }
}

const opt = (v: bigint | null): string | null => (v === null ? null : scaledToDecimal(v))

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

interface ParsedDeal {
  readonly raw: RawMt5Deal
  readonly index: number
  readonly side: Mt5ExecutionSide
  readonly quantity: bigint
  readonly price: bigint
  readonly profit: bigint | null
  readonly commission: bigint | null
  readonly fee: bigint | null
  readonly swap: bigint | null
}

interface PositionBucket {
  readonly positionId: string
  firstIndex: number
  readonly deals: ParsedDeal[]
  readonly tickets: string[]
  readonly poison: Set<UnresolvedReason>
}

type Outcome =
  | { kind: 'completed'; value: CompletedTradeCandidate }
  | { kind: 'open'; value: OpenLifecycleCandidate }
  | { kind: 'unresolved'; value: UnresolvedLifecycle }

interface LifecycleRecord {
  readonly firstIndex: number
  readonly lastIndex: number
  readonly symbol: string | null
  outcome: Outcome
}

function diag(
  severity: NormalizationDiagnostic['severity'],
  code: string,
  message: string,
  dealTicket: string | null,
  positionId: string | null
): NormalizationDiagnostic {
  return { severity, code, message, dealTicket, positionId }
}

const RESOLUTION_NEEDS: Partial<Record<UnresolvedReason, string>> = {
  OUT_BY_UNSUPPORTED:
    'the counter (opposite) position identifier of the close-by and how much volume each position gave up; not carried by contract v1 deals',
  INOUT_NOT_PRODUCTION_PROVEN:
    'a real netting/exchange capture proving DEAL_POSITION_ID behavior across a reversal (same id vs new id) and how commission/profit split between closing and reversal portions',
  MISSING_OPENING_DEAL: 'the opening (DEAL_ENTRY_IN) deal — likely outside the synchronized history window',
  CANCELED_DEAL_PRESENT: 'the semantics of which earlier deal the cancellation reverses',
  UNSUPPORTED_DEAL_ENTRY: 'documented, verified semantics for this DEAL_ENTRY value'
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function normalizeMt5Deals(
  input: readonly RawMt5Deal[],
  account: Mt5AccountContext
): Mt5NormalizationResult {
  const diagnostics: NormalizationDiagnostic[] = []
  const ignored: IgnoredDeal[] = []
  const rejected: RejectedDeal[] = []
  const buckets = new Map<string, PositionBucket>()

  // 1. Account scoping + dedupe by stable source deal identity ---------------
  const byIdentity = new Map<string, RawMt5Deal[]>()
  for (const deal of input) {
    if (deal.server !== account.server || deal.accountLogin !== account.accountLogin) {
      ignored.push({
        dealTicket: deal.dealTicket,
        dealType: deal.dealType,
        dealTypeLabel: dealTypeLabel(deal.dealType),
        reason: 'ACCOUNT_MISMATCH'
      })
      diagnostics.push(diag('error', 'ACCOUNT_MISMATCH', 'Deal belongs to a different server/account and was excluded.', deal.dealTicket, deal.positionId))
      continue
    }
    const key = rawDealIdentity(deal)
    const list = byIdentity.get(key)
    if (list === undefined) byIdentity.set(key, [deal])
    else list.push(deal)
  }

  const unique: RawMt5Deal[] = []
  let duplicatesDropped = 0
  const conflictPositions = new Map<string, string[]>() // positionId -> tickets
  for (const key of [...byIdentity.keys()].sort()) {
    const versions = byIdentity.get(key) as RawMt5Deal[]
    const distinct = new Set(versions.map(stableJson))
    if (distinct.size === 1) {
      unique.push(versions[0] as RawMt5Deal)
      if (versions.length > 1) {
        duplicatesDropped += versions.length - 1
        diagnostics.push(
          diag('info', 'DUPLICATE_DEAL_IGNORED', `Deal seen ${versions.length} times with identical facts; counted once.`, (versions[0] as RawMt5Deal).dealTicket, (versions[0] as RawMt5Deal).positionId)
        )
      }
    } else {
      // Same identity, different facts: which is right is unknowable. Drop all, poison every position touched.
      const first = versions[0] as RawMt5Deal
      rejected.push({ dealTicket: first.dealTicket, positionId: first.positionId, dealType: first.dealType, dealEntry: first.dealEntry, reason: 'DEAL_CONFLICT' })
      diagnostics.push(diag('error', 'DEAL_CONFLICT', 'Same deal identity reported with different facts; all versions withheld.', first.dealTicket, first.positionId))
      for (const v of versions) {
        if (v.positionId === '0') continue
        const tickets = conflictPositions.get(v.positionId) ?? []
        tickets.push(v.dealTicket)
        conflictPositions.set(v.positionId, tickets)
      }
    }
  }

  // 2. Canonical order -------------------------------------------------------
  unique.sort(compareDealsCanonically)

  const bucketFor = (positionId: string, index: number): PositionBucket => {
    let bucket = buckets.get(positionId)
    if (bucket === undefined) {
      bucket = { positionId, firstIndex: index, deals: [], tickets: [], poison: new Set() }
      buckets.set(positionId, bucket)
    }
    return bucket
  }
  for (const [positionId, tickets] of conflictPositions) {
    const bucket = bucketFor(positionId, Number.MAX_SAFE_INTEGER)
    bucket.poison.add('DEAL_CONFLICT')
    bucket.tickets.push(...tickets)
  }

  // 3. Classify --------------------------------------------------------------
  let tradingDeals = 0
  unique.forEach((deal, index) => {
    const reject = (reason: RejectedReason, poison: UnresolvedReason | null, message: string): void => {
      rejected.push({ dealTicket: deal.dealTicket, positionId: deal.positionId, dealType: deal.dealType, dealEntry: deal.dealEntry, reason })
      diagnostics.push(diag('error', reason, message, deal.dealTicket, deal.positionId === '0' ? null : deal.positionId))
      if (deal.positionId !== '0' && poison !== null) {
        const bucket = bucketFor(deal.positionId, index)
        bucket.firstIndex = Math.min(bucket.firstIndex, index)
        bucket.tickets.push(deal.dealTicket)
        bucket.poison.add(poison)
      }
    }

    if (deal.dealType === DEAL_TYPE_BUY_CANCELED || deal.dealType === DEAL_TYPE_SELL_CANCELED) {
      reject('CANCELED_DEAL', 'CANCELED_DEAL_PRESENT', 'Cancelled deal: its effect on the position is not modeled; lifecycle withheld.')
      return
    }
    if (deal.dealType !== DEAL_TYPE_BUY && deal.dealType !== DEAL_TYPE_SELL) {
      const label = dealTypeLabel(deal.dealType)
      if (label === null) {
        reject('UNKNOWN_DEAL_TYPE', 'INVALID_DEAL_PRESENT', `Unknown DEAL_TYPE ${deal.dealType}; never interpreted as BUY/SELL.`)
      } else {
        ignored.push({ dealTicket: deal.dealTicket, dealType: deal.dealType, dealTypeLabel: label, reason: 'NON_TRADING_DEAL_TYPE' })
        diagnostics.push(diag('info', 'NON_TRADING_DEAL_IGNORED', `Non-trading deal type ${label}; not a Trade.`, deal.dealTicket, null))
      }
      return
    }

    tradingDeals += 1
    if (deal.dealEntry < ENTRY_IN || deal.dealEntry > ENTRY_OUT_BY) {
      reject('UNSUPPORTED_DEAL_ENTRY', 'UNSUPPORTED_DEAL_ENTRY', `DEAL_ENTRY ${deal.dealEntry} is not IN/OUT/INOUT/OUT_BY; not treated as an entry or exit.`)
      return
    }
    if (deal.positionId === '0') {
      reject('MISSING_POSITION_ID', null, 'Trading deal has no DEAL_POSITION_ID; cannot belong to a lifecycle.')
      return
    }
    if (deal.symbol === null) {
      reject('MISSING_SYMBOL', 'INVALID_DEAL_PRESENT', 'Trading deal has no symbol.')
      return
    }
    let parsed: ParsedDeal
    try {
      const quantity = decimalToScaled(deal.volume)
      const price = decimalToScaled(deal.price)
      if (quantity <= 0n) {
        reject('INVALID_QUANTITY', 'INVALID_DEAL_PRESENT', 'Trading deal volume must be > 0.')
        return
      }
      if (price <= 0n) {
        reject('INVALID_PRICE', 'INVALID_DEAL_PRESENT', 'Trading deal price must be > 0.')
        return
      }
      parsed = {
        raw: deal,
        index,
        side: deal.dealType === DEAL_TYPE_BUY ? 'BUY' : 'SELL',
        quantity,
        price,
        profit: deal.profit === null ? null : decimalToScaled(deal.profit),
        commission: deal.commission === null ? null : decimalToScaled(deal.commission),
        fee: deal.fee === null ? null : decimalToScaled(deal.fee),
        swap: deal.swap === null ? null : decimalToScaled(deal.swap)
      }
    } catch {
      reject('INVALID_DECIMAL', 'INVALID_DEAL_PRESENT', 'Deal carries a value that is not an exact decimal.')
      return
    }
    const bucket = bucketFor(deal.positionId, index)
    bucket.firstIndex = Math.min(bucket.firstIndex, index)
    bucket.deals.push(parsed)
    bucket.tickets.push(deal.dealTicket)
  })

  // 4. Reconstruct each source position -------------------------------------
  const records: LifecycleRecord[] = []
  const orderedBuckets = [...buckets.values()].sort((a, b) => a.firstIndex - b.firstIndex || (BigInt(a.positionId) < BigInt(b.positionId) ? -1 : 1))
  for (const bucket of orderedBuckets) {
    const record = reconstruct(bucket, account, diagnostics)
    records.push(record)
  }

  // 5. Netting/exchange: one active position per symbol is a platform property.
  if (account.accounting === 'RETAIL_NETTING' || account.accounting === 'EXCHANGE') {
    flagSymbolOverlaps(records, diagnostics)
  }

  const completed: CompletedTradeCandidate[] = []
  const open: OpenLifecycleCandidate[] = []
  const unresolved: UnresolvedLifecycle[] = []
  for (const r of records) {
    if (r.outcome.kind === 'completed') completed.push(r.outcome.value)
    else if (r.outcome.kind === 'open') open.push(r.outcome.value)
    else unresolved.push(r.outcome.value)
  }

  return {
    account,
    completed,
    open,
    unresolved,
    ignored,
    rejected,
    diagnostics,
    stats: {
      rawDealsReceived: input.length,
      duplicateDealsDropped: duplicatesDropped,
      tradingDeals,
      ignoredDeals: ignored.length,
      rejectedDeals: rejected.length,
      completed: completed.length,
      open: open.length,
      unresolved: unresolved.length
    }
  }
}

// ---------------------------------------------------------------------------
// Per-position lifecycle reconstruction
// ---------------------------------------------------------------------------

function reconstruct(
  bucket: PositionBucket,
  account: Mt5AccountContext,
  diagnostics: NormalizationDiagnostic[]
): LifecycleRecord {
  const key = sourceLifecycleKey(account.server, account.accountLogin, bucket.positionId)
  const reasons = new Set<UnresolvedReason>(bucket.poison)
  if (account.accounting === null) reasons.add('ACCOUNTING_MODE_UNKNOWN')
  const inout: InoutObservation[] = []
  const executions: NormalizedExecution[] = []
  const entries: ParsedDeal[] = []
  const exits: ParsedDeal[] = []

  let direction: Mt5TradeDirection | null = null
  let symbol: string | null = null
  let opened = 0n
  let closed = 0n
  let halted = false

  const halt = (reason: UnresolvedReason, deal: ParsedDeal, message: string): void => {
    reasons.add(reason)
    halted = true
    diagnostics.push(diag('error', reason, message, deal.raw.dealTicket, bucket.positionId))
  }

  for (const deal of bucket.deals) {
    const entry = deal.raw.dealEntry
    if (entry === ENTRY_INOUT || entry === ENTRY_OUT_BY) {
      if (entry === ENTRY_OUT_BY) {
        if (!reasons.has('OUT_BY_UNSUPPORTED')) {
          diagnostics.push(diag('error', 'OUT_BY_UNSUPPORTED', 'Close-by deal: needs the counter position identifier and volumes; lifecycle withheld, not guessed.', deal.raw.dealTicket, bucket.positionId))
        }
        reasons.add('OUT_BY_UNSUPPORTED')
      } else {
        const known = !halted && direction !== null
        const remaining = opened - closed
        inout.push({
          dealTicket: deal.raw.dealTicket,
          side: deal.side,
          dealQuantity: scaledToDecimal(deal.quantity),
          priorDirection: known ? direction : null,
          priorRemainingQuantity: known ? scaledToDecimal(remaining) : null,
          candidateClosingQuantity: known ? scaledToDecimal(deal.quantity < remaining ? deal.quantity : remaining) : null,
          candidateReversalQuantity: known ? scaledToDecimal(deal.quantity > remaining ? deal.quantity - remaining : 0n) : null
        })
        if (!reasons.has('INOUT_NOT_PRODUCTION_PROVEN')) {
          diagnostics.push(diag('error', 'INOUT_NOT_PRODUCTION_PROVEN', 'INOUT (reversal) deal: segmentation is not production-proven; lifecycle withheld, not guessed.', deal.raw.dealTicket, bucket.positionId))
        }
        reasons.add('INOUT_NOT_PRODUCTION_PROVEN')
      }
      halted = true
      continue
    }
    if (halted) continue

    if (symbol === null) symbol = deal.raw.symbol
    else if (symbol !== deal.raw.symbol) {
      halt('SYMBOL_MISMATCH', deal, 'Deals of one position id report different symbols.')
      continue
    }

    const dealDirection: Mt5TradeDirection = deal.side === 'BUY' ? 'LONG' : 'SHORT'
    if (entry === ENTRY_IN) {
      if (direction === null) direction = dealDirection
      else if (direction !== dealDirection) {
        halt('ENTRY_AGAINST_DIRECTION', deal, 'Entry deal opposes the position direction set by its opening deal.')
        continue
      }
      if (opened > 0n && opened === closed) {
        halt('REOPEN_AFTER_CLOSE', deal, 'Entry deal after the position id already reached zero; not guessed as a new lifecycle.')
        continue
      }
      opened += deal.quantity
      entries.push(deal)
      executions.push(toExecution(deal, executions.length + 1, 'ENTRY', account))
    } else {
      // ENTRY_OUT
      if (direction === null) {
        halt('MISSING_OPENING_DEAL', deal, 'Position id starts with an exit; the opening deal is not in the data.')
        continue
      }
      if (dealDirection === direction) {
        halt('EXIT_WITH_DIRECTION', deal, 'Exit deal has the same side as the position direction.')
        continue
      }
      if (deal.quantity > opened - closed) {
        halt('OVER_CLOSE', deal, 'Exit quantity exceeds the known open quantity; remaining quantity is not forced to zero.')
        continue
      }
      closed += deal.quantity
      exits.push(deal)
      executions.push(toExecution(deal, executions.length + 1, 'EXIT', account))
    }
  }

  const lastIndex = Math.max(
    bucket.deals.length > 0 ? (bucket.deals[bucket.deals.length - 1] as ParsedDeal).index : -1,
    bucket.firstIndex === Number.MAX_SAFE_INTEGER ? -1 : bucket.firstIndex
  )
  const firstIndex = bucket.firstIndex === Number.MAX_SAFE_INTEGER ? lastIndex : bucket.firstIndex

  if (reasons.size > 0) {
    const ordered = [...reasons].sort()
    const needs = ordered.map((r) => RESOLUTION_NEEDS[r]).filter((n): n is string => n !== undefined)
    return {
      firstIndex,
      lastIndex,
      symbol,
      outcome: {
        kind: 'unresolved',
        value: {
          sourceLifecycleKey: key,
          sourcePositionId: bucket.positionId,
          symbol,
          reasons: ordered,
          dealTickets: bucket.tickets,
          openedQuantity: direction === null ? null : scaledToDecimal(opened),
          closedQuantity: direction === null ? null : scaledToDecimal(closed),
          remainingQuantity: direction === null ? null : scaledToDecimal(opened - closed),
          inout,
          needs
        }
      }
    }
  }

  // Valid, consistent lifecycle: direction/symbol are set because entries is non-empty
  // (a lifecycle with no reasons and no deals cannot exist: buckets are created by a deal or a reason).
  const dir = direction as Mt5TradeDirection
  const entryAvg = weightedAverage(entries.map((d) => ({ q: d.quantity, p: d.price })))
  const exitAvg = exits.length === 0 ? null : weightedAverage(exits.map((d) => ({ q: d.quantity, p: d.price })))
  const all = bucket.deals
  const gross = sumNullable(all.map((d) => d.profit))
  const commission = sumNullable(all.map((d) => d.commission))
  const fees = sumNullable(all.map((d) => d.fee))
  const swap = sumNullable(all.map((d) => d.swap))
  const net = gross === null ? null : gross + (commission ?? 0n) + (fees ?? 0n) + (swap ?? 0n)
  const remaining = opened - closed
  const first = all[0] as ParsedDeal
  const last = all[all.length - 1] as ParsedDeal

  const facts = {
    sourceLifecycleKey: key,
    source: 'MT5' as const,
    server: account.server,
    accountLogin: account.accountLogin,
    sourcePositionId: bucket.positionId,
    symbol: symbol as string,
    direction: dir,
    openedAtMsc: first.raw.timeMsc,
    openedQuantity: scaledToDecimal(opened),
    closedQuantity: scaledToDecimal(closed),
    remainingQuantity: scaledToDecimal(remaining),
    avgEntryPrice: scaledToDecimal(entryAvg.value),
    avgEntryPriceExact: entryAvg.exact,
    avgExitPrice: exitAvg === null ? null : scaledToDecimal(exitAvg.value),
    avgExitPriceExact: exitAvg === null ? null : exitAvg.exact,
    grossPnl: opt(gross),
    commission: opt(commission),
    fees: opt(fees),
    swap: opt(swap),
    netPnl: opt(net),
    executions
  }
  if (remaining === 0n) {
    return { firstIndex, lastIndex, symbol, outcome: { kind: 'completed', value: { ...facts, status: 'COMPLETED', closedAtMsc: last.raw.timeMsc } } }
  }
  return { firstIndex, lastIndex, symbol, outcome: { kind: 'open', value: { ...facts, status: 'OPEN', lastActivityAtMsc: last.raw.timeMsc } } }
}

function toExecution(deal: ParsedDeal, sequence: number, role: Mt5ExecutionRole, account: Mt5AccountContext): NormalizedExecution {
  return {
    source: 'MT5',
    server: account.server,
    accountLogin: account.accountLogin,
    dealTicket: deal.raw.dealTicket,
    orderTicket: deal.raw.orderTicket,
    positionId: deal.raw.positionId,
    sourceExecutionKey: rawDealIdentity(deal.raw),
    sequence,
    executedAtMsc: deal.raw.timeMsc,
    side: deal.side,
    role,
    quantity: scaledToDecimal(deal.quantity),
    price: scaledToDecimal(deal.price),
    profit: opt(deal.profit),
    commission: opt(deal.commission),
    fees: opt(deal.fee),
    swap: opt(deal.swap)
  }
}

/**
 * Netting/exchange platforms hold one net position per symbol, so two
 * time-overlapping lifecycles on one symbol contradict the platform model.
 * Both are withheld rather than one being trusted over the other.
 */
function flagSymbolOverlaps(
  records: LifecycleRecord[],
  diagnostics: NormalizationDiagnostic[]
): void {
  const live = records.filter((r) => r.outcome.kind !== 'unresolved' && r.symbol !== null)
  const flagged = new Set<LifecycleRecord>()
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i] as LifecycleRecord
      const b = live[j] as LifecycleRecord
      if (a.symbol !== b.symbol) continue
      const aEnd = a.outcome.kind === 'open' ? Infinity : a.lastIndex
      const bEnd = b.outcome.kind === 'open' ? Infinity : b.lastIndex
      if (a.firstIndex < bEnd && b.firstIndex < aEnd) {
        flagged.add(a)
        flagged.add(b)
      }
    }
  }
  for (const r of records) {
    if (!flagged.has(r) || r.outcome.kind === 'unresolved') continue
    const v = r.outcome.value
    diagnostics.push(diag('error', 'NETTING_SYMBOL_OVERLAP', 'Overlapping lifecycles on one symbol contradict netting semantics; withheld.', null, v.sourcePositionId))
    r.outcome = {
      kind: 'unresolved',
      value: {
        sourceLifecycleKey: v.sourceLifecycleKey,
        sourcePositionId: v.sourcePositionId,
        symbol: v.symbol,
        reasons: ['NETTING_SYMBOL_OVERLAP'],
        dealTickets: v.executions.map((e) => e.dealTicket),
        openedQuantity: v.openedQuantity,
        closedQuantity: v.closedQuantity,
        remainingQuantity: v.remainingQuantity,
        inout: [],
        needs: ['confirmation of how this platform assigns position identifiers within one netting symbol position']
      }
    }
  }
}
