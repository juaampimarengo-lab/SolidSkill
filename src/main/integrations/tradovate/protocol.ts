/**
 * Tradovate raw source-fact contract (spike v1).
 *
 * READ-ONLY: these types describe FACTS Solid Skill reads from Tradovate's
 * REST/WebSocket API. Nothing here can place, modify, cancel, or close an
 * order, flatten a position, or modify a bracket/stop/target. There is no
 * write-capable field or method anywhere in this module.
 *
 * Tradovate gets its OWN raw-fact vocabulary. It is not fed through the MT5
 * normalizer and does not import MT5 raw types (see docs/TRADOVATE_RAW_CONTRACT.md,
 * "Tradovate must not pretend to be MT5").
 *
 * Decimal handling deliberately duplicates (does not import) the MT5 module's
 * decimal grammar, so this module has zero dependency on the MT5 integration.
 * The grammar itself matches the shared persistence boundary
 * (src/main/persistence/fixedPoint.ts): decimal strings, scale <= 8, never
 * JS numbers, never rounded.
 */

export const TRADOVATE_SOURCE = 'Tradovate' as const
export const TRADOVATE_CONTRACT_VERSION = 1 as const

/** Canonical decimal text, scale <= 8. See docs/TRADOVATE_RAW_CONTRACT.md §6. */
export type Decimal = string

const DECIMAL_SCALE = 8
const DECIMAL_TEXT = /^[+-]?\d+(?:\.\d+)?$/
const INT64_MAX = 9223372036854775807n

/**
 * Validates decimal text and returns its canonical form, or null when it is
 * not exactly representable at scale 8 in a signed 64-bit integer. Mirrors
 * (independently of) src/main/persistence/fixedPoint.ts; nothing is rounded.
 */
export function canonicalizeDecimal(text: string): Decimal | null {
  if (text.length > 40 || !DECIMAL_TEXT.test(text)) return null
  const negative = text.startsWith('-')
  const unsigned = text.replace(/^[+-]/, '')
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const trimmedFraction = fraction.replace(/0+$/, '')
  if (trimmedFraction.length > DECIMAL_SCALE) return null
  const wholeDigits = whole.replace(/^0+(?=\d)/, '')
  const scaled = BigInt(wholeDigits) * 10n ** BigInt(DECIMAL_SCALE) + BigInt(trimmedFraction.padEnd(DECIMAL_SCALE, '0'))
  if (scaled > INT64_MAX) return null
  if (scaled === 0n) return '0'
  const body = trimmedFraction === '' ? wholeDigits : `${wholeDigits}.${trimmedFraction}`
  return negative ? `-${body}` : body
}

// ---------------------------------------------------------------------------
// Raw source fact types
// ---------------------------------------------------------------------------

/**
 * A Tradovate trading account, as reported by GET account/list (or
 * account/item). `id` is Tradovate's own numeric account id — a SOURCE
 * identifier, never a Solid Skill primary key.
 *
 * NOTE ON EVIDENCE: field names below follow the REST entity conventions
 * documented at https://api.tradovate.com/ and the Partner API reference
 * (https://partner.tradovate.com/), current as of 2026-09-21. Tradovate's
 * full account schema was not independently re-verified against a live
 * response in this spike (no credentials were exercised — see
 * docs/TRADOVATE_INTEGRATION_SPIKE.md §"Real access gate").
 */
export interface RawTradovateAccount {
  /** Tradovate's numeric account id. Source identity, never a Solid Skill key. */
  readonly id: string
  readonly name: string
  /** Tradovate "userId" that owns this account (source identity only). */
  readonly userId: string
  /** e.g. "Demo", "Live" — reported, never inferred/guessed. */
  readonly accountType: string | null
  readonly active: boolean | null
  readonly clearingHouseId: string | null
  /** Legal/business name of the entity behind the account, e.g. a prop firm's clearing name. Nullable. */
  readonly legalStatus: string | null
}

/** A Tradovate futures contract/instrument, as reported by GET contract/item. */
export interface RawTradovateContract {
  readonly id: string
  /** e.g. "MNQZ6" (dated, specific contract). Never collapsed to a continuous symbol. */
  readonly name: string
  /** Product family, e.g. "MNQ". Reported only; not used to merge contract identity. */
  readonly productId: string | null
  readonly expirationDate: string | null
}

/**
 * A Tradovate order, kept ONLY as provenance for the fills it produced. An
 * Order is not an execution and never becomes a Trade by itself. Solid Skill
 * never issues, modifies, or cancels one.
 *
 * OFFICIAL SOURCE (confirmed 2026-09-22):
 * `https://partner.tradovate.com/api/rest-api-endpoints/orders/order-list.md`.
 * Official Order fields: `accountId` (required), `timestamp` (required),
 * `action` (required, "Buy"|"Sell"), `ordStatus` (required — Canceled,
 * Completed, Expired, Filled, PendingCancel, PendingNew, PendingReplace,
 * Rejected, Suspended, Unknown, Working), `admin` (required), `id`,
 * `contractId`, `spreadDefinitionId`, `executionProviderId`, `ocoId`,
 * `parentId`, `linkedId` (all optional). There is **no documented
 * `orderType` field** on the Order entity itself (an earlier draft of this
 * contract assumed one; corrected here). `accountId` IS present and
 * required on Order — this is the join Solid Skill uses to attribute a Fill
 * (which has no `accountId` of its own — see `RawTradovateFill`) to an
 * account.
 */
export interface RawTradovateOrder {
  readonly id: string
  readonly accountId: string
  readonly contractId: string | null
  /** "Buy" | "Sell" as reported. Raw text preserved verbatim; not re-encoded to an enum here. */
  readonly action: string
  readonly ordStatus: string
  readonly timestamp: string
}

/**
 * A Tradovate fill: one execution fact. Ground truth, analogous to an MT5
 * deal.
 *
 * OFFICIAL SOURCE (confirmed 2026-09-22):
 * `https://partner.tradovate.com/api/rest-api-endpoints/orders/fill-list.md`
 * and `.../fill-item.md`. The **official Fill entity fields are exactly**:
 * `orderId`, `contractId`, `timestamp`, `tradeDate` ({year,month,day}),
 * `action` ("Buy"|"Sell"), `qty`, `price`, `active`, `finallyPaired`, `id`.
 *
 * **CORRECTION from the original spike draft:** the official Fill entity has
 * **NO `accountId` field** (directly or nested) and **NO
 * `realizedPnl`/`commission`/`fees` field**. Two consequences, both
 * reflected below:
 *
 * 1. `accountId` on this type is **ADAPTER-ATTRIBUTED**, not a native
 *    Tradovate Fill field: a real transport must resolve it by joining the
 *    fill's `orderId` against `RawTradovateOrder.accountId` (the documented
 *    `order/item?id=<orderId>` or `order/list` call). It is preserved here
 *    because Solid Skill's staging/normalization is account-scoped, but any
 *    future implementer must not assume Tradovate hands this to you for
 *    free on the fill itself.
 * 2. Realized P&L / commission / fees are **not fields of Fill at all**.
 *    They live on separate, officially documented entities
 *    (`RawTradovateFillPair`, `RawTradovateFillFee`) which this contract
 *    keeps as their own raw facts rather than folding into Fill (see
 *    docs/TRADOVATE_RAW_CONTRACT.md §9). This normalizer therefore does not
 *    compute Trade-level gross/commission/fees in this checkpoint — cost/PnL
 *    attribution is deferred pending real-account evidence of how
 *    FillFee/FillPair rows actually link to specific fills.
 *
 * There is **no confirmed, official per-fill position/lifecycle ticket**
 * analogous to MT5's `DEAL_POSITION_ID`. See
 * docs/TRADOVATE_INTEGRATION_SPIKE.md §"Position/lifecycle identity" for the
 * full treatment of why `(accountId, contractId, openingFillId)` is used as
 * a **temporary reconstruction key**, explicitly not a durable Trade
 * identity.
 */
export interface RawTradovateFill {
  readonly source: typeof TRADOVATE_SOURCE
  readonly contractVersion: typeof TRADOVATE_CONTRACT_VERSION
  /** ADAPTER-ATTRIBUTED (joined from `orderId` -> Order.accountId). Not a native Fill field — see the type doc above. */
  readonly accountId: string
  readonly contractId: string
  /** ADAPTER-ATTRIBUTED (joined from Contract lookup by `contractId`). Not a native Fill field. */
  readonly contractName: string
  /** Tradovate fill id. Part of stable identity; never an array index. */
  readonly fillId: string
  /** The order that produced this fill (official `orderId` field). Provenance and the account join key (Order != Fill). */
  readonly orderId: string
  /** "Buy" | "Sell" exactly as reported (official `action` field). No direction is encoded here. */
  readonly action: 'Buy' | 'Sell'
  /** Official `qty` field. */
  readonly quantity: Decimal
  /** Official `price` field. */
  readonly price: Decimal
  /**
   * Fill timestamp exactly as reported by Tradovate (official `timestamp`
   * field; documented as UTC ISO-8601). Preserved verbatim; see
   * docs/TRADOVATE_RAW_CONTRACT.md §7 for the timestamp-semantics caveat.
   */
  readonly timestamp: string
  /** Official `tradeDate` ({year,month,day}) reassembled as "YYYY-MM-DD". Preserved as reported, never used as a session-boundary policy. */
  readonly tradeDate: string
  /** Official `active` field. Meaning not independently confirmed against a real account (see docs/TRADOVATE_RAW_CONTRACT.md §9a). */
  readonly active: boolean
  /** Official `finallyPaired` field. Preserved as a raw hint at Tradovate's own pairing state; not interpreted or relied on by this normalizer. */
  readonly finallyPaired: number
  /** Where the fact came from: an initial/backfill history pull, or a live user-sync push. Solid Skill-added provenance, not a Tradovate field. */
  readonly origin: 'history' | 'live'
}

/** Stable identity of a raw Tradovate fill. Not identity: timestamp, contract, or arrival order. */
export function rawFillIdentity(fill: Pick<RawTradovateFill, 'source' | 'accountId' | 'fillId'>): string {
  return JSON.stringify([fill.source, fill.accountId, fill.fillId])
}

/**
 * A Tradovate position snapshot row. OFFICIAL SOURCE (confirmed 2026-09-22):
 * `https://partner.tradovate.com/api/rest-api-endpoints/positions/position-list.md`.
 * Official fields: `accountId`, `contractId`, `timestamp`, `tradeDate`
 * (required); `netPos`, `bought`, `boughtValue`, `sold`, `soldValue`,
 * `prevPos` (required); `id`, `netPrice`, `prevPrice` (optional).
 *
 * **This is a per-(account, contract, tradeDate) accounting SNAPSHOT, not a
 * trade-lifecycle ticket.** It carries no start/end-of-lifecycle marker and
 * no confirmed link to which specific fills produced its `netPos`. Kept as
 * a **provenance / reconciliation fact only** — see
 * docs/TRADOVATE_INTEGRATION_SPIKE.md §"Position / FillPair audit": Solid
 * Skill does NOT treat `Position.id` as a Solid Skill Trade identity.
 */
export interface RawTradovatePosition {
  readonly id: string | null
  readonly accountId: string
  readonly contractId: string
  readonly netPos: string
  readonly bought: string
  readonly boughtValue: Decimal
  readonly sold: string
  readonly soldValue: Decimal
  readonly prevPos: string
  readonly netPrice: Decimal | null
  readonly prevPrice: Decimal | null
  /** Official `tradeDate` ({year,month,day}) reassembled as "YYYY-MM-DD". */
  readonly tradeDate: string
  readonly timestamp: string
}

/**
 * A Tradovate buy/sell fill pairing. OFFICIAL SOURCE (confirmed 2026-09-22):
 * `https://partner.tradovate.com/api/rest-api-endpoints/positions/fill-pair-list.md`.
 * Official fields: `positionId`, `buyFillId`, `sellFillId`, `qty`,
 * `buyPrice`, `sellPrice`, `active` (required); `id` (optional).
 *
 * **This is Tradovate's OWN internal realized-matching record (most likely
 * FIFO; not confirmed), not a Solid Skill analytical Trade.** Kept as a
 * provenance / reconciliation fact only. See
 * docs/TRADOVATE_INTEGRATION_SPIKE.md §"FillPair caution" for the open
 * questions (partial exits, one fill in multiple pairs, whether this
 * reflects the provider's accounting rather than the user's analytical
 * grouping) that must be answered against a real account before this is
 * used for anything beyond reconciliation evidence.
 */
export interface RawTradovateFillPair {
  readonly id: string | null
  readonly positionId: string
  readonly buyFillId: string
  readonly sellFillId: string
  readonly qty: string
  readonly buyPrice: Decimal
  readonly sellPrice: Decimal
  readonly active: boolean
}

/**
 * A Tradovate per-fill fee breakdown. OFFICIAL SOURCE (confirmed
 * 2026-09-22): `https://partner.tradovate.com/api/rest-api-endpoints/orders/fill-fee-list.md`.
 * Official fields: `id`, `clearingFee`/`clearingCurrencyId`,
 * `exchangeFee`/`exchangeCurrencyId`, `nfaFee`/`nfaCurrencyId`,
 * `brokerageFee`/`brokerageCurrencyId`, `ipFee`/`ipCurrencyId`,
 * `commission`/`commissionCurrencyId`,
 * `orderRoutingFee`/`orderRoutingCurrencyId`. Every fee/currency pair is
 * independently nullable; `null` = not reported, never an invented zero.
 *
 * **UNRESOLVED (see docs/TRADOVATE_RAW_CONTRACT.md §9a):** the documented
 * FillFee entity carries **no `fillId` field**. The generic REST dependents
 * convention (`<entity>/deps?masterid=<id>`) suggests
 * `fillFee/deps?masterid=<fillId>` is the intended lookup, but this is
 * **not confirmed** against a real account. `attributedFillId` below is
 * therefore explicitly nullable and explicitly named to signal it is an
 * adapter-side attribution, never a native FillFee field.
 */
export interface RawTradovateFillFee {
  readonly id: string
  /** Adapter-attributed via the (unconfirmed) fillFee/deps?masterid=<fillId> convention. Null when not resolved. */
  readonly attributedFillId: string | null
  readonly clearingFee: Decimal | null
  readonly clearingCurrencyId: string | null
  readonly exchangeFee: Decimal | null
  readonly exchangeCurrencyId: string | null
  readonly nfaFee: Decimal | null
  readonly nfaCurrencyId: string | null
  readonly brokerageFee: Decimal | null
  readonly brokerageCurrencyId: string | null
  readonly ipFee: Decimal | null
  readonly ipCurrencyId: string | null
  readonly commission: Decimal | null
  readonly commissionCurrencyId: string | null
  readonly orderRoutingFee: Decimal | null
  readonly orderRoutingCurrencyId: string | null
}

/** Identity helpers for the reconciliation-only entities. Never used as Trade identity. */
export function rawPositionIdentity(position: Pick<RawTradovatePosition, 'accountId' | 'contractId' | 'tradeDate'>): string {
  return JSON.stringify(['Tradovate', 'Position', position.accountId, position.contractId, position.tradeDate])
}
export function rawFillPairIdentity(pair: Pick<RawTradovateFillPair, 'buyFillId' | 'sellFillId'>): string {
  return JSON.stringify(['Tradovate', 'FillPair', pair.buyFillId, pair.sellFillId])
}
export function rawFillFeeIdentity(fee: Pick<RawTradovateFillFee, 'id'>): string {
  return JSON.stringify(['Tradovate', 'FillFee', fee.id])
}
