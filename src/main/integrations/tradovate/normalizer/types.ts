/**
 * Output vocabulary of the Tradovate normalizer. Pure data: no HTTP,
 * WebSocket, SQLite, Electron, Strategy, or UI knowledge. See
 * docs/TRADOVATE_INTEGRATION_SPIKE.md and docs/TRADOVATE_RAW_CONTRACT.md.
 *
 * Money/quantity/price fields are canonical decimal STRINGS (scale <= 8),
 * never JS numbers.
 *
 * COST/P&L IS DELIBERATELY NOT COMPUTED HERE. The official Tradovate Fill
 * entity carries no realized-P&L/commission/fee field (confirmed
 * 2026-09-22 — see docs/TRADOVATE_RAW_CONTRACT.md §9). That data lives on
 * separate `RawTradovateFillPair` / `RawTradovateFillFee` entities whose
 * linkage to a specific Fill/lifecycle is not yet confirmed against a real
 * account. Rather than guess a join, this normalizer produces exposure /
 * direction / quantity facts only; cost/P&L attribution is future work
 * gated on real evidence (see the spike doc, "FillPair caution" / "Fees").
 */
import type { Decimal } from '../protocol'

export type TradovateTradeDirection = 'LONG' | 'SHORT'
export type TradovateExecutionSide = 'BUY' | 'SELL'
/** ENTRY = opens/increases exposure. EXIT = reduces/closes it. */
export type TradovateExecutionRole = 'ENTRY' | 'EXIT'

export interface TradovateAccountContext {
  /** Tradovate account id. Identity only; never logged unmasked outside this module. */
  readonly accountId: string
}

/**
 * One trading fill participating in a lifecycle. Provenance is the source
 * fill identity — never an array index. `sequence` is the 1-based canonical
 * order inside the lifecycle and is derived, not identifying.
 */
export interface NormalizedTradovateExecution {
  readonly source: 'Tradovate'
  readonly accountId: string
  readonly contractId: string
  readonly contractName: string
  /** Tradovate fill id. */
  readonly fillId: string
  /** Tradovate order id — kept for provenance only; an Order is not a Fill. */
  readonly orderId: string
  /** rawFillIdentity(): JSON [source, accountId, fillId]. */
  readonly sourceExecutionKey: string
  readonly sequence: number
  /** Fill timestamp exactly as reported (see docs/TRADOVATE_RAW_CONTRACT.md §7). */
  readonly executedAtIso: string
  readonly side: TradovateExecutionSide
  readonly role: TradovateExecutionRole
  readonly quantity: Decimal
  readonly price: Decimal
}

/** Lifecycle facts shared by completed and open candidates. */
interface LifecycleFacts {
  /**
   * Deterministic source identity: JSON ["Tradovate", accountId, contractId,
   * openingFillId]. NOT the Solid Skill Trade UUID (a future import service
   * owns that), and — critically — **NOT a durable, officially-confirmed
   * Tradovate lifecycle identity either**.
   *
   * GROUPING KEY != DURABLE TRADE IDENTITY. `(accountId, contractId)` alone
   * is only a TEMPORARY reconstruction bucket: a single account/contract can
   * legitimately have many independent flat -> position -> flat round trips
   * over time (proven by the "two independent round trips" synthetic test),
   * so the bucket is further segmented by each round trip's own OPENING
   * fill id (`openingFillId`, below) rather than a position-in-sequence
   * counter. A sequence counter was rejected deliberately: if an earlier
   * completed round trip is discovered later (e.g. an expanded historical
   * fetch), a counter-based key would silently renumber and invalidate an
   * already-persisted identity, whereas the opening fill's own stable
   * Tradovate id cannot shift under reordering. This is still explicitly a
   * TEMPORARY choice pending real evidence (see
   * docs/TRADOVATE_INTEGRATION_SPIKE.md §"Lifecycle identity correction")
   * — a future checkpoint may replace it entirely once real Position/
   * FillPair linkage is confirmed.
   */
  readonly sourceLifecycleKey: string
  readonly source: 'Tradovate'
  readonly accountId: string
  readonly contractId: string
  readonly contractName: string
  /** The fill id that opened this specific round trip. See sourceLifecycleKey above. */
  readonly openingFillId: string
  /** From the OPENING fill side only. Never from a closing fill. */
  readonly direction: TradovateTradeDirection
  readonly openedAtIso: string
  readonly openedQuantity: Decimal
  readonly closedQuantity: Decimal
  readonly remainingQuantity: Decimal
  /** Volume-weighted over ENTRY fills, rounded half-up to scale 8. */
  readonly avgEntryPrice: Decimal
  readonly avgEntryPriceExact: boolean
  readonly avgExitPrice: Decimal | null
  readonly avgExitPriceExact: boolean | null
  readonly executions: readonly NormalizedTradovateExecution[]
}

/** A proven, fully closed lifecycle: remainingQuantity is exactly 0. */
export interface TradovateCompletedTradeCandidate extends LifecycleFacts {
  readonly status: 'COMPLETED'
  readonly closedAtIso: string
}

/**
 * A lifecycle that has opened and not yet reached zero. NOT a Trade and never
 * to be persisted as a closed historical Trade.
 */
export interface TradovateOpenLifecycleCandidate extends LifecycleFacts {
  readonly status: 'OPEN'
  readonly lastActivityAtIso: string
}

/**
 * Note: unlike MT5's `DEAL_ENTRY` flag, a Tradovate fill carries no explicit
 * entry/exit marker — direction and role are purely inferred from side vs.
 * running exposure. There is therefore no reachable "entry fill contradicts
 * direction" or "exit exceeds remaining" case distinct from a reversal: an
 * opposite-side fill either reduces/closes cleanly or IS a reversal (below).
 */
export type TradovateUnresolvedReason = 'CONTRACT_MISMATCH' | 'REVERSAL_NOT_PRODUCTION_PROVEN' | 'FILL_CONFLICT' | 'INVALID_FILL_PRESENT'

/**
 * Observation of a fill whose quantity exceeds the current remaining
 * exposure on the opposite side — a candidate netting reversal. Preserved
 * but NOT applied/segmented: see docs/TRADOVATE_RAW_CONTRACT.md §"Reversal
 * segmentation is unresolved".
 */
export interface TradovateReversalObservation {
  readonly fillId: string
  readonly side: TradovateExecutionSide
  readonly fillQuantity: Decimal
  readonly priorDirection: TradovateTradeDirection | null
  readonly priorRemainingQuantity: Decimal | null
  /** min(fillQuantity, priorRemaining). Null when prior state unknown. */
  readonly candidateClosingQuantity: Decimal | null
  /** fillQuantity - priorRemaining when positive, else "0". Null when prior state unknown. */
  readonly candidateReversalQuantity: Decimal | null
}

export interface TradovateUnresolvedLifecycle {
  readonly sourceLifecycleKey: string
  readonly accountId: string
  readonly contractId: string
  readonly reasons: readonly TradovateUnresolvedReason[]
  /** Ids of every fill that belongs to this unresolved segment (conflict fills first). */
  readonly fillIds: readonly string[]
  readonly openedQuantity: Decimal | null
  readonly closedQuantity: Decimal | null
  readonly remainingQuantity: Decimal | null
  readonly reversals: readonly TradovateReversalObservation[]
  readonly needs: readonly string[]
}

export type TradovateRejectedReason = 'INVALID_QUANTITY' | 'INVALID_PRICE' | 'INVALID_DECIMAL' | 'UNKNOWN_ACTION' | 'FILL_CONFLICT'

/** A fill that could not be interpreted safely. Never becomes an Execution. */
export interface TradovateRejectedFill {
  readonly fillId: string
  readonly accountId: string
  readonly contractId: string
  readonly reason: TradovateRejectedReason
}

export type TradovateDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface TradovateNormalizationDiagnostic {
  readonly severity: TradovateDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly fillId: string | null
  readonly contractId: string | null
}

export interface TradovateNormalizationStats {
  readonly rawFillsReceived: number
  readonly duplicateFillsDropped: number
  readonly tradingFills: number
  readonly rejectedFills: number
  readonly completed: number
  readonly open: number
  readonly unresolved: number
}

/** Deterministic: identical for the same fill SET regardless of input order. */
export interface TradovateNormalizationResult {
  readonly account: TradovateAccountContext
  readonly completed: readonly TradovateCompletedTradeCandidate[]
  readonly open: readonly TradovateOpenLifecycleCandidate[]
  readonly unresolved: readonly TradovateUnresolvedLifecycle[]
  readonly rejected: readonly TradovateRejectedFill[]
  readonly diagnostics: readonly TradovateNormalizationDiagnostic[]
  readonly stats: TradovateNormalizationStats
}
