/**
 * Output vocabulary of the MT5 normalizer. Pure data: no SQLite, Electron,
 * IPC, Strategy, or UI knowledge. See docs/MT5_NORMALIZATION.md.
 *
 * Money/quantity/price fields are canonical decimal STRINGS (scale <= 8), never
 * JS numbers. Costs use the persistence sign convention: signed P&L
 * contributions (a cost is negative), null = the source did not report it.
 */
import type { Decimal, PositionAccounting } from '../protocol'

export type Mt5TradeDirection = 'LONG' | 'SHORT'
export type Mt5ExecutionSide = 'BUY' | 'SELL'
/** ENTRY = DEAL_ENTRY_IN (adds exposure). EXIT = DEAL_ENTRY_OUT (reduces it). */
export type Mt5ExecutionRole = 'ENTRY' | 'EXIT'

export interface Mt5AccountContext {
  readonly server: string
  /** ACCOUNT_LOGIN. Identity only; never logged unmasked. */
  readonly accountLogin: string
  /** From ACCOUNT_MARGIN_MODE. null = unknown: nothing can then be reconstructed. */
  readonly accounting: PositionAccounting | null
}

/**
 * One trading deal participating in a lifecycle. Provenance is the source
 * deal identity — never an array index. `sequence` is the 1-based canonical
 * order inside the lifecycle and is derived, not identifying.
 */
export interface NormalizedExecution {
  readonly source: 'MT5'
  readonly server: string
  readonly accountLogin: string
  /** DEAL_TICKET. */
  readonly dealTicket: string
  /** DEAL_ORDER — kept for provenance only; an Order is not a Deal. */
  readonly orderTicket: string
  /** DEAL_POSITION_ID. */
  readonly positionId: string
  /** rawDealIdentity(): JSON [source, server, login, dealTicket]. */
  readonly sourceExecutionKey: string
  readonly sequence: number
  /** DEAL_TIME_MSC exactly as reported (broker SERVER time, not converted). */
  readonly executedAtMsc: number
  readonly side: Mt5ExecutionSide
  readonly role: Mt5ExecutionRole
  readonly quantity: Decimal
  readonly price: Decimal
  /** DEAL_PROFIT as reported (null = not reported; 0 is a real reported zero). */
  readonly profit: Decimal | null
  readonly commission: Decimal | null
  readonly fees: Decimal | null
  readonly swap: Decimal | null
}

/** Lifecycle facts shared by completed and open candidates. */
interface LifecycleFacts {
  /**
   * Deterministic source identity: JSON ["MT5", server, accountLogin,
   * positionId]. NOT the Solid Skill Trade UUID (the import service owns that).
   */
  readonly sourceLifecycleKey: string
  readonly source: 'MT5'
  readonly server: string
  readonly accountLogin: string
  /** DEAL_POSITION_ID. */
  readonly sourcePositionId: string
  readonly symbol: string
  /** From the OPENING deal side only. Never from an exit. */
  readonly direction: Mt5TradeDirection
  readonly openedAtMsc: number
  readonly openedQuantity: Decimal
  readonly closedQuantity: Decimal
  readonly remainingQuantity: Decimal
  /** Volume-weighted over ENTRY executions, rounded half-up to scale 8. */
  readonly avgEntryPrice: Decimal
  /** false when the weighted average was not exactly representable at scale 8. */
  readonly avgEntryPriceExact: boolean
  readonly avgExitPrice: Decimal | null
  readonly avgExitPriceExact: boolean | null
  /** Sum of reported DEAL_PROFIT; null when no deal reported one. */
  readonly grossPnl: Decimal | null
  /** Sum of reported values per category; null when no deal reported that category. */
  readonly commission: Decimal | null
  readonly fees: Decimal | null
  readonly swap: Decimal | null
  /** gross + commission + fees + swap (null counted as 0); null when grossPnl is null. */
  readonly netPnl: Decimal | null
  readonly executions: readonly NormalizedExecution[]
}

/** A proven, fully closed lifecycle: remainingQuantity is exactly 0. */
export interface CompletedTradeCandidate extends LifecycleFacts {
  readonly status: 'COMPLETED'
  readonly closedAtMsc: number
}

/**
 * A lifecycle that has opened and not yet reached zero. NOT a Trade and never
 * to be persisted as a closed historical Trade. Its P&L/cost fields are the
 * REALIZED-SO-FAR sums over deals seen; remainingQuantity is > 0.
 */
export interface OpenLifecycleCandidate extends LifecycleFacts {
  readonly status: 'OPEN'
  readonly lastActivityAtMsc: number
}

export type UnresolvedReason =
  | 'ACCOUNTING_MODE_UNKNOWN'
  | 'MISSING_OPENING_DEAL'
  | 'OVER_CLOSE'
  | 'ENTRY_AGAINST_DIRECTION'
  | 'EXIT_WITH_DIRECTION'
  | 'REOPEN_AFTER_CLOSE'
  | 'SYMBOL_MISMATCH'
  | 'INOUT_NOT_PRODUCTION_PROVEN'
  | 'OUT_BY_UNSUPPORTED'
  | 'UNSUPPORTED_DEAL_ENTRY'
  | 'CANCELED_DEAL_PRESENT'
  | 'INVALID_DEAL_PRESENT'
  | 'DEAL_CONFLICT'
  | 'NETTING_SYMBOL_OVERLAP'

/**
 * Information about an INOUT deal, preserved but NOT applied: how the deal
 * would split IF it is a reversal on the same lifecycle. Segmentation is not
 * production-proven (no real netting capture yet), so nothing is emitted.
 */
export interface InoutObservation {
  readonly dealTicket: string
  readonly side: Mt5ExecutionSide
  readonly dealQuantity: Decimal
  /** Position direction and remaining quantity immediately before this deal, when known. */
  readonly priorDirection: Mt5TradeDirection | null
  readonly priorRemainingQuantity: Decimal | null
  /** min(dealQuantity, priorRemaining). Null when prior state unknown. */
  readonly candidateClosingQuantity: Decimal | null
  /** dealQuantity - priorRemaining when positive, else "0". Null when prior state unknown. */
  readonly candidateReversalQuantity: Decimal | null
}

export interface UnresolvedLifecycle {
  readonly sourceLifecycleKey: string
  readonly sourcePositionId: string
  readonly symbol: string | null
  readonly reasons: readonly UnresolvedReason[]
  /** Tickets of every deal that belongs to this position id (canonical order; deal-conflict tickets first). */
  readonly dealTickets: readonly string[]
  /** Reconstruction state at the moment the lifecycle became unresolved (best effort, may be null). */
  readonly openedQuantity: Decimal | null
  readonly closedQuantity: Decimal | null
  readonly remainingQuantity: Decimal | null
  readonly inout: readonly InoutObservation[]
  /** Extra fact that would be needed to resolve (e.g. counter-position id for OUT_BY). */
  readonly needs: readonly string[]
}

export type IgnoredReason = 'NON_TRADING_DEAL_TYPE' | 'ACCOUNT_MISMATCH'

export interface IgnoredDeal {
  readonly dealTicket: string
  readonly dealType: number
  readonly dealTypeLabel: string | null
  readonly reason: IgnoredReason
}

export type RejectedReason =
  | 'UNKNOWN_DEAL_TYPE'
  | 'CANCELED_DEAL'
  | 'UNSUPPORTED_DEAL_ENTRY'
  | 'INVALID_QUANTITY'
  | 'INVALID_PRICE'
  | 'INVALID_DECIMAL'
  | 'MISSING_SYMBOL'
  | 'MISSING_POSITION_ID'
  | 'DEAL_CONFLICT'

/** A deal that could not be interpreted safely. Never becomes an Execution. */
export interface RejectedDeal {
  readonly dealTicket: string
  readonly positionId: string
  readonly dealType: number
  readonly dealEntry: number
  readonly reason: RejectedReason
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export interface NormalizationDiagnostic {
  readonly severity: DiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly dealTicket: string | null
  readonly positionId: string | null
}

export interface Mt5NormalizationStats {
  readonly rawDealsReceived: number
  readonly duplicateDealsDropped: number
  readonly tradingDeals: number
  readonly ignoredDeals: number
  readonly rejectedDeals: number
  readonly completed: number
  readonly open: number
  readonly unresolved: number
}

/** Deterministic: identical for the same deal SET regardless of input order. */
export interface Mt5NormalizationResult {
  readonly account: Mt5AccountContext
  readonly completed: readonly CompletedTradeCandidate[]
  readonly open: readonly OpenLifecycleCandidate[]
  readonly unresolved: readonly UnresolvedLifecycle[]
  readonly ignored: readonly IgnoredDeal[]
  readonly rejected: readonly RejectedDeal[]
  readonly diagnostics: readonly NormalizationDiagnostic[]
  readonly stats: Mt5NormalizationStats
}
