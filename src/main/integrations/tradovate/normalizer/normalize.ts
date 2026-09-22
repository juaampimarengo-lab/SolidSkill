/**
 * Tradovate raw fills -> lifecycle candidates. PURE and DETERMINISTIC: no I/O,
 * no SQLite, no Electron, no clock, no randomness. Same fill SET (any arrival
 * order) -> byte-identical result. See docs/TRADOVATE_RAW_CONTRACT.md.
 *
 * Invariants enforced here:
 *  - Direction comes ONLY from the fill that moves exposure from FLAT to
 *    non-zero. A closing fill's side never decides direction
 *    (docs/TRADE_MODEL_CONCEPTS.md §5).
 *  - The unit of reconstruction is (accountId, contractId), FURTHER
 *    segmented by each independent round trip's own opening fill id — see
 *    the extensive comment on `sourceLifecycleKey` in ./types.ts
 *    ("GROUPING KEY != DURABLE TRADE IDENTITY"). A single account/contract
 *    can and does have many independent flat -> position -> flat round
 *    trips over time; they are never merged into one lifecycle merely
 *    because accountId+contractId match.
 *  - Anything not provable from the raw facts (a reversal, an inconsistent
 *    sequence) is returned as an explicit unresolved result. Nothing is
 *    guessed, nothing is forced.
 *  - No cost/P&L is computed here (see ./types.ts header) and no
 *    methodology, strategy, or setup concept exists at this layer.
 */
import { decimalToScaled, scaledToDecimal } from '../../../persistence/fixedPoint'
import type { RawTradovateFill } from '../protocol'
import { rawFillIdentity } from '../protocol'
import type {
  TradovateAccountContext,
  TradovateCompletedTradeCandidate,
  TradovateExecutionRole,
  TradovateExecutionSide,
  TradovateNormalizationDiagnostic,
  TradovateNormalizationResult,
  TradovateOpenLifecycleCandidate,
  TradovateRejectedFill,
  TradovateRejectedReason,
  TradovateReversalObservation,
  TradovateTradeDirection,
  TradovateUnresolvedLifecycle,
  TradovateUnresolvedReason,
  NormalizedTradovateExecution
} from './types'

/** Ordered key JSON so two structurally equal fills compare equal regardless of key order. */
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

/** Canonical chronological order: timestamp, then numeric fill id. Arrival order is never consulted. */
export function compareFillsCanonically(a: RawTradovateFill, b: RawTradovateFill): number {
  const ta = Date.parse(a.timestamp)
  const tb = Date.parse(b.timestamp)
  if (ta !== tb) return ta < tb ? -1 : 1
  const fa = BigInt(a.fillId)
  const fb = BigInt(b.fillId)
  return fa === fb ? 0 : fa < fb ? -1 : 1
}

/**
 * TEMPORARY reconstruction key — see the extensive warning on
 * `LifecycleFacts.sourceLifecycleKey` in ./types.ts. Anchored to the
 * segment's own opening fill id (stable under later-discovered history),
 * never a position-in-sequence counter.
 */
export function sourceLifecycleKey(accountId: string, contractId: string, openingFillId: string): string {
  return JSON.stringify(['Tradovate', accountId, contractId, openingFillId])
}

// ---------------------------------------------------------------------------
// Exact arithmetic (scale 8 bigint)
// ---------------------------------------------------------------------------

/** sum(q*p)/sum(q) at scale 8, rounded half-up; exact=false when rounding occurred. */
function weightedAverage(parts: readonly { q: bigint; p: bigint }[]): { value: bigint; exact: boolean } {
  let notional = 0n
  let quantity = 0n
  for (const { q, p } of parts) {
    notional += q * p
    quantity += q
  }
  const value = (2n * notional + quantity) / (2n * quantity)
  return { value, exact: notional % quantity === 0n }
}

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

interface ParsedFill {
  readonly raw: RawTradovateFill
  readonly index: number
  readonly side: TradovateExecutionSide
  readonly quantity: bigint
  readonly price: bigint
}

interface LifecycleBucket {
  readonly accountId: string
  readonly contractId: string
  firstIndex: number
  readonly fills: ParsedFill[]
  readonly fillIds: string[]
  readonly poison: Set<TradovateUnresolvedReason>
}

type Outcome =
  | { kind: 'completed'; value: TradovateCompletedTradeCandidate }
  | { kind: 'open'; value: TradovateOpenLifecycleCandidate }
  | { kind: 'unresolved'; value: TradovateUnresolvedLifecycle }

function diag(
  severity: TradovateNormalizationDiagnostic['severity'],
  code: string,
  message: string,
  fillId: string | null,
  contractId: string | null
): TradovateNormalizationDiagnostic {
  return { severity, code, message, fillId, contractId }
}

const RESOLUTION_NEEDS: Partial<Record<TradovateUnresolvedReason, string>> = {
  REVERSAL_NOT_PRODUCTION_PROVEN:
    'a real Tradovate account capture proving how a same-contract reversal fill should be segmented into closing vs. reopening portions, and whether the API links it to a new or continued lifecycle',
  FILL_CONFLICT: 'confirmation from Tradovate of which version of the conflicting fill is authoritative'
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function normalizeTradovateFills(
  input: readonly RawTradovateFill[],
  account: TradovateAccountContext
): TradovateNormalizationResult {
  const diagnostics: TradovateNormalizationDiagnostic[] = []
  const rejected: TradovateRejectedFill[] = []
  const buckets = new Map<string, LifecycleBucket>()

  // 1. Account scoping + dedupe by stable source fill identity ---------------
  const byIdentity = new Map<string, RawTradovateFill[]>()
  for (const fill of input) {
    if (fill.accountId !== account.accountId) {
      diagnostics.push(diag('error', 'ACCOUNT_MISMATCH', 'Fill belongs to a different account and was excluded.', fill.fillId, fill.contractId))
      continue
    }
    const key = rawFillIdentity(fill)
    const list = byIdentity.get(key)
    if (list === undefined) byIdentity.set(key, [fill])
    else list.push(fill)
  }

  const unique: RawTradovateFill[] = []
  let duplicatesDropped = 0
  const conflictContracts = new Map<string, string[]>() // contractId -> fillIds
  for (const key of [...byIdentity.keys()].sort()) {
    const versions = byIdentity.get(key) as RawTradovateFill[]
    const distinct = new Set(versions.map(stableJson))
    if (distinct.size === 1) {
      unique.push(versions[0] as RawTradovateFill)
      if (versions.length > 1) {
        duplicatesDropped += versions.length - 1
        diagnostics.push(
          diag('info', 'DUPLICATE_FILL_IGNORED', `Fill seen ${versions.length} times with identical facts; counted once.`, (versions[0] as RawTradovateFill).fillId, (versions[0] as RawTradovateFill).contractId)
        )
      }
    } else {
      const first = versions[0] as RawTradovateFill
      rejected.push({ fillId: first.fillId, accountId: first.accountId, contractId: first.contractId, reason: 'FILL_CONFLICT' })
      diagnostics.push(diag('error', 'FILL_CONFLICT', 'Same fill identity reported with different facts; all versions withheld.', first.fillId, first.contractId))
      for (const v of versions) {
        const ids = conflictContracts.get(v.contractId) ?? []
        ids.push(v.fillId)
        conflictContracts.set(v.contractId, ids)
      }
    }
  }

  // 2. Canonical order -------------------------------------------------------
  unique.sort(compareFillsCanonically)

  const bucketFor = (contractId: string, index: number): LifecycleBucket => {
    let bucket = buckets.get(contractId)
    if (bucket === undefined) {
      bucket = { accountId: account.accountId, contractId, firstIndex: index, fills: [], fillIds: [], poison: new Set() }
      buckets.set(contractId, bucket)
    }
    return bucket
  }
  for (const [contractId, fillIds] of conflictContracts) {
    const bucket = bucketFor(contractId, Number.MAX_SAFE_INTEGER)
    bucket.poison.add('FILL_CONFLICT')
    bucket.fillIds.push(...fillIds)
  }

  // 3. Classify ----------------------------------------------------------
  let tradingFills = 0
  unique.forEach((fill, index) => {
    const reject = (reason: TradovateRejectedReason, poison: TradovateUnresolvedReason | null, message: string): void => {
      rejected.push({ fillId: fill.fillId, accountId: fill.accountId, contractId: fill.contractId, reason })
      diagnostics.push(diag('error', reason, message, fill.fillId, fill.contractId))
      if (poison !== null) {
        const bucket = bucketFor(fill.contractId, index)
        bucket.firstIndex = Math.min(bucket.firstIndex, index)
        bucket.fillIds.push(fill.fillId)
        bucket.poison.add(poison)
      }
    }

    if (fill.action !== 'Buy' && fill.action !== 'Sell') {
      reject('UNKNOWN_ACTION', 'INVALID_FILL_PRESENT', `Unknown fill action ${JSON.stringify(fill.action)}; never interpreted as Buy/Sell.`)
      return
    }

    tradingFills += 1
    let parsed: ParsedFill
    try {
      const quantity = decimalToScaled(fill.quantity)
      const price = decimalToScaled(fill.price)
      if (quantity <= 0n) {
        reject('INVALID_QUANTITY', 'INVALID_FILL_PRESENT', 'Fill quantity must be > 0.')
        return
      }
      if (price <= 0n) {
        reject('INVALID_PRICE', 'INVALID_FILL_PRESENT', 'Fill price must be > 0.')
        return
      }
      parsed = { raw: fill, index, side: fill.action === 'Buy' ? 'BUY' : 'SELL', quantity, price }
    } catch {
      reject('INVALID_DECIMAL', 'INVALID_FILL_PRESENT', 'Fill carries a value that is not an exact decimal.')
      return
    }
    const bucket = bucketFor(fill.contractId, index)
    bucket.firstIndex = Math.min(bucket.firstIndex, index)
    bucket.fills.push(parsed)
    bucket.fillIds.push(fill.fillId)
  })

  // 4. Reconstruct each (account, contract) bucket into one or more independent
  //    round-trip SEGMENTS -----------------------------------------------------
  const records: { firstIndex: number; outcome: Outcome }[] = []
  const orderedBuckets = [...buckets.values()].sort((a, b) => a.firstIndex - b.firstIndex)
  for (const bucket of orderedBuckets) {
    for (const outcome of reconstructBucket(bucket, diagnostics)) records.push(outcome)
  }

  const completed: TradovateCompletedTradeCandidate[] = []
  const open: TradovateOpenLifecycleCandidate[] = []
  const unresolved: TradovateUnresolvedLifecycle[] = []
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
    rejected,
    diagnostics,
    stats: {
      rawFillsReceived: input.length,
      duplicateFillsDropped: duplicatesDropped,
      tradingFills,
      rejectedFills: rejected.length,
      completed: completed.length,
      open: open.length,
      unresolved: unresolved.length
    }
  }
}

// ---------------------------------------------------------------------------
// Per-(account, contract) bucket -> one or more independent round-trip segments
// ---------------------------------------------------------------------------

interface SegmentState {
  openingFillId: string | null
  direction: TradovateTradeDirection | null
  contractName: string | null
  opened: bigint
  closed: bigint
  entries: ParsedFill[]
  exits: ParsedFill[]
  executions: NormalizedTradovateExecution[]
  fillIds: string[]
}

function freshSegment(): SegmentState {
  return { openingFillId: null, direction: null, contractName: null, opened: 0n, closed: 0n, entries: [], exits: [], executions: [], fillIds: [] }
}

function reconstructBucket(bucket: LifecycleBucket, diagnostics: TradovateNormalizationDiagnostic[]): { firstIndex: number; outcome: Outcome }[] {
  // A bucket-level poison reason (e.g. a FILL_CONFLICT seen before any fill was
  // parsed) taints the WHOLE (account, contract) bucket: we cannot safely
  // segment fills we already know are unreliable.
  if (bucket.poison.size > 0) {
    return [
      {
        firstIndex: bucket.firstIndex,
        outcome: {
          kind: 'unresolved',
          value: {
            sourceLifecycleKey: sourceLifecycleKey(bucket.accountId, bucket.contractId, bucket.fillIds[0] ?? '0'),
            accountId: bucket.accountId,
            contractId: bucket.contractId,
            reasons: [...bucket.poison].sort(),
            fillIds: bucket.fillIds,
            openedQuantity: null,
            closedQuantity: null,
            remainingQuantity: null,
            reversals: [],
            needs: [...bucket.poison].map((r) => RESOLUTION_NEEDS[r]).filter((n): n is string => n !== undefined)
          }
        }
      }
    ]
  }

  const outcomes: { firstIndex: number; outcome: Outcome }[] = []
  let seg = freshSegment()
  let bucketHalted = false

  const finalizeCompleted = (): void => {
    outcomes.push({ firstIndex: (seg.entries[0] as ParsedFill).index, outcome: { kind: 'completed', value: buildCompleted(bucket, seg) } })
    seg = freshSegment()
  }
  const finalizeOpen = (): void => {
    outcomes.push({ firstIndex: (seg.entries[0] as ParsedFill).index, outcome: { kind: 'open', value: buildOpen(bucket, seg) } })
  }
  const finalizeUnresolved = (reasons: readonly TradovateUnresolvedReason[], reversals: readonly TradovateReversalObservation[]): void => {
    const first = seg.fillIds[0] ?? bucket.fillIds[0] ?? '0'
    outcomes.push({
      firstIndex: seg.entries.length > 0 ? (seg.entries[0] as ParsedFill).index : bucket.firstIndex,
      outcome: {
        kind: 'unresolved',
        value: {
          sourceLifecycleKey: sourceLifecycleKey(bucket.accountId, bucket.contractId, first),
          accountId: bucket.accountId,
          contractId: bucket.contractId,
          reasons: [...reasons].sort(),
          fillIds: seg.fillIds,
          openedQuantity: seg.direction === null ? null : scaledToDecimal(seg.opened),
          closedQuantity: seg.direction === null ? null : scaledToDecimal(seg.closed),
          remainingQuantity: seg.direction === null ? null : scaledToDecimal(seg.opened - seg.closed),
          reversals,
          needs: [...reasons].map((r) => RESOLUTION_NEEDS[r]).filter((n): n is string => n !== undefined)
        }
      }
    })
  }

  for (const fill of bucket.fills) {
    if (bucketHalted) {
      seg.fillIds.push(fill.raw.fillId)
      continue
    }

    if (seg.contractName === null) seg.contractName = fill.raw.contractName
    else if (seg.contractName !== fill.raw.contractName) {
      seg.fillIds.push(fill.raw.fillId)
      diagnostics.push(diag('error', 'CONTRACT_MISMATCH', 'Fills of one contract id report different contract names.', fill.raw.fillId, bucket.contractId))
      bucketHalted = true
      finalizeUnresolved(['CONTRACT_MISMATCH'], [])
      continue
    }

    const fillDirection: TradovateTradeDirection = fill.side === 'BUY' ? 'LONG' : 'SHORT'
    const remaining = seg.opened - seg.closed

    if (seg.direction === null) {
      // Starts a new round trip: either the very first fill in this bucket,
      // or the fill right after the previous round trip returned to flat.
      seg.direction = fillDirection
      seg.openingFillId = fill.raw.fillId
      seg.opened += fill.quantity
      seg.entries.push(fill)
      seg.fillIds.push(fill.raw.fillId)
      seg.executions.push(toExecution(fill, seg.executions.length + 1, 'ENTRY'))
      continue
    }

    if (fillDirection === seg.direction) {
      // Same side as this round trip's direction: scale-in.
      seg.opened += fill.quantity
      seg.entries.push(fill)
      seg.fillIds.push(fill.raw.fillId)
      seg.executions.push(toExecution(fill, seg.executions.length + 1, 'ENTRY'))
      continue
    }

    // Opposite side: reduces, closes, or (if larger than remaining) reverses exposure.
    if (fill.quantity > remaining) {
      const reversal: TradovateReversalObservation = {
        fillId: fill.raw.fillId,
        side: fill.side,
        fillQuantity: scaledToDecimal(fill.quantity),
        priorDirection: seg.direction,
        priorRemainingQuantity: scaledToDecimal(remaining),
        candidateClosingQuantity: scaledToDecimal(remaining),
        candidateReversalQuantity: scaledToDecimal(fill.quantity - remaining)
      }
      diagnostics.push(
        diag(
          'error',
          'REVERSAL_NOT_PRODUCTION_PROVEN',
          'Opposite-side fill exceeds remaining exposure (a netting reversal): segmentation is not production-proven; lifecycle withheld, not guessed.',
          fill.raw.fillId,
          bucket.contractId
        )
      )
      seg.fillIds.push(fill.raw.fillId)
      bucketHalted = true
      finalizeUnresolved(['REVERSAL_NOT_PRODUCTION_PROVEN'], [reversal])
      continue
    }

    seg.closed += fill.quantity
    seg.exits.push(fill)
    seg.fillIds.push(fill.raw.fillId)
    seg.executions.push(toExecution(fill, seg.executions.length + 1, 'EXIT'))

    if (seg.opened - seg.closed === 0n) {
      // Round trip complete: finalize this segment and start fresh so a
      // LATER independent round trip on the same (account, contract) is
      // never merged into this one.
      finalizeCompleted()
    }
  }

  if (!bucketHalted && seg.direction !== null && seg.opened - seg.closed > 0n) {
    finalizeOpen()
  }

  return outcomes
}

function buildCompleted(bucket: LifecycleBucket, seg: SegmentState): TradovateCompletedTradeCandidate {
  const entryAvg = weightedAverage(seg.entries.map((d) => ({ q: d.quantity, p: d.price })))
  const exitAvg = seg.exits.length === 0 ? null : weightedAverage(seg.exits.map((d) => ({ q: d.quantity, p: d.price })))
  const first = seg.entries[0] as ParsedFill
  const last = (seg.exits[seg.exits.length - 1] ?? seg.entries[seg.entries.length - 1]) as ParsedFill
  return {
    sourceLifecycleKey: sourceLifecycleKey(bucket.accountId, bucket.contractId, seg.openingFillId as string),
    source: 'Tradovate',
    accountId: bucket.accountId,
    contractId: bucket.contractId,
    contractName: seg.contractName as string,
    openingFillId: seg.openingFillId as string,
    direction: seg.direction as TradovateTradeDirection,
    openedAtIso: first.raw.timestamp,
    openedQuantity: scaledToDecimal(seg.opened),
    closedQuantity: scaledToDecimal(seg.closed),
    remainingQuantity: scaledToDecimal(seg.opened - seg.closed),
    avgEntryPrice: scaledToDecimal(entryAvg.value),
    avgEntryPriceExact: entryAvg.exact,
    avgExitPrice: exitAvg === null ? null : scaledToDecimal(exitAvg.value),
    avgExitPriceExact: exitAvg === null ? null : exitAvg.exact,
    executions: seg.executions,
    status: 'COMPLETED',
    closedAtIso: last.raw.timestamp
  }
}

function buildOpen(bucket: LifecycleBucket, seg: SegmentState): TradovateOpenLifecycleCandidate {
  const entryAvg = weightedAverage(seg.entries.map((d) => ({ q: d.quantity, p: d.price })))
  const exitAvg = seg.exits.length === 0 ? null : weightedAverage(seg.exits.map((d) => ({ q: d.quantity, p: d.price })))
  const first = seg.entries[0] as ParsedFill
  const last = (seg.exits[seg.exits.length - 1] ?? seg.entries[seg.entries.length - 1]) as ParsedFill
  return {
    sourceLifecycleKey: sourceLifecycleKey(bucket.accountId, bucket.contractId, seg.openingFillId as string),
    source: 'Tradovate',
    accountId: bucket.accountId,
    contractId: bucket.contractId,
    contractName: seg.contractName as string,
    openingFillId: seg.openingFillId as string,
    direction: seg.direction as TradovateTradeDirection,
    openedAtIso: first.raw.timestamp,
    openedQuantity: scaledToDecimal(seg.opened),
    closedQuantity: scaledToDecimal(seg.closed),
    remainingQuantity: scaledToDecimal(seg.opened - seg.closed),
    avgEntryPrice: scaledToDecimal(entryAvg.value),
    avgEntryPriceExact: entryAvg.exact,
    avgExitPrice: exitAvg === null ? null : scaledToDecimal(exitAvg.value),
    avgExitPriceExact: exitAvg === null ? null : exitAvg.exact,
    executions: seg.executions,
    status: 'OPEN',
    lastActivityAtIso: last.raw.timestamp
  }
}

function toExecution(fill: ParsedFill, sequence: number, role: TradovateExecutionRole): NormalizedTradovateExecution {
  return {
    source: 'Tradovate',
    accountId: fill.raw.accountId,
    contractId: fill.raw.contractId,
    contractName: fill.raw.contractName,
    fillId: fill.raw.fillId,
    orderId: fill.raw.orderId,
    sourceExecutionKey: rawFillIdentity(fill.raw),
    sequence,
    executedAtIso: fill.raw.timestamp,
    side: fill.side,
    role,
    quantity: scaledToDecimal(fill.quantity),
    price: scaledToDecimal(fill.price)
  }
}
