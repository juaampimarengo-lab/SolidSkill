import type { RawTradovateFill, RawTradovateFillFee, RawTradovateFillPair, RawTradovatePosition } from '../protocol'

const ACCOUNT_A = 'acct-1001'
const ACCOUNT_B = 'acct-2002'
const CONTRACT_MNQ = 'contract-mnq-1'
const CONTRACT_ES = 'contract-es-1'

export { ACCOUNT_A, ACCOUNT_B, CONTRACT_MNQ, CONTRACT_ES }

let fillSeq = 1000
let orderSeq = 500
let feeSeq = 1

function nextFillId(): string {
  fillSeq += 1
  return String(fillSeq)
}
function nextOrderId(): string {
  orderSeq += 1
  return String(orderSeq)
}
export function nextFeeId(): string {
  feeSeq += 1
  return String(feeSeq)
}

export function fill(
  overrides: Partial<RawTradovateFill> & {
    readonly accountId: string
    readonly contractId: string
    readonly action: 'Buy' | 'Sell'
    readonly quantity: string
    readonly price: string
    readonly timestamp: string
  }
): RawTradovateFill {
  return {
    source: 'Tradovate',
    contractVersion: 1,
    contractName: overrides.contractId === CONTRACT_MNQ ? 'MNQZ6' : 'ESZ6',
    fillId: nextFillId(),
    orderId: nextOrderId(),
    tradeDate: overrides.timestamp.slice(0, 10),
    active: true,
    finallyPaired: 0,
    origin: 'history',
    ...overrides
  }
}

// 1. Simple long: BUY in, SELL out.
export const SIMPLE_LONG: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-01T14:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20010', timestamp: '2026-09-01T14:05:00.000Z' })
]

// 2. Simple short: SELL in, BUY out.
export const SIMPLE_SHORT: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Sell', quantity: '2', price: '5000', timestamp: '2026-09-01T15:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Buy', quantity: '2', price: '4995', timestamp: '2026-09-01T15:10:00.000Z' })
]

// 5/9. Multiple entry fills + single order producing multiple fills (order id repeats).
export const MULTI_FILL_ONE_ORDER: readonly RawTradovateFill[] = (() => {
  const orderId = nextOrderId()
  return [
    fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-02T10:00:00.000Z', orderId }),
    fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20001', timestamp: '2026-09-02T10:00:00.500Z', orderId }),
    fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '2', price: '20020', timestamp: '2026-09-02T10:05:00.000Z' })
  ]
})()

// 6/8. Scale-in then scale-out (partial exit) before full close.
export const SCALE_IN_PARTIAL_OUT: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-03T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20005', timestamp: '2026-09-03T10:01:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20010', timestamp: '2026-09-03T10:05:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20015', timestamp: '2026-09-03T10:10:00.000Z' })
]

// 7. Standalone partial exit leaves an OPEN lifecycle.
export const PARTIAL_EXIT_STAYS_OPEN: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Buy', quantity: '3', price: '5000', timestamp: '2026-09-04T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Sell', quantity: '1', price: '5010', timestamp: '2026-09-04T10:05:00.000Z' })
]

// 10. Two accounts, same contract, isolated from each other.
export const TWO_ACCOUNTS_SAME_CONTRACT: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-05T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20010', timestamp: '2026-09-05T10:05:00.000Z' }),
  fill({ accountId: ACCOUNT_B, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20000', timestamp: '2026-09-05T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_B, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '19990', timestamp: '2026-09-05T10:05:00.000Z' })
]

// 11. Two instruments open concurrently on the same account, isolated.
export const TWO_INSTRUMENTS_ONE_ACCOUNT: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-06T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Sell', quantity: '1', price: '5000', timestamp: '2026-09-06T10:01:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20010', timestamp: '2026-09-06T10:05:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Buy', quantity: '1', price: '4990', timestamp: '2026-09-06T10:06:00.000Z' })
]

// 12/13. Identical replay dedup + conflicting duplicate source id.
const CONFLICT_BASE = fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-07T10:00:00.000Z' })
export const REPLAY_IDENTICAL: readonly RawTradovateFill[] = [CONFLICT_BASE, CONFLICT_BASE]
export const REPLAY_CONFLICTING: readonly RawTradovateFill[] = [
  CONFLICT_BASE,
  { ...CONFLICT_BASE, price: '20001' } // same fillId, different price -> conflict
]

// 14. Out-of-order facts must still reconstruct correctly (canonical sort by time).
export const OUT_OF_ORDER: readonly RawTradovateFill[] = (() => {
  const entry = fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-08T10:00:00.000Z' })
  const exit = fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20010', timestamp: '2026-09-08T10:05:00.000Z' })
  return [exit, entry] // delivered exit-first; must still resolve as LONG
})()

// 15. Same-timestamp deterministic ordering (tie-break by numeric fill id).
export const SAME_TIMESTAMP: readonly RawTradovateFill[] = (() => {
  const t = '2026-09-09T10:00:00.000Z'
  const a = fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: t })
  const b = fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20010', timestamp: t })
  return [b, a] // arrival order reversed; canonical order must be by numeric fillId (a before b)
})()

// 16. Open lifecycle (never closes).
export const OPEN_LIFECYCLE: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Buy', quantity: '1', price: '5000', timestamp: '2026-09-10T10:00:00.000Z' })
]

// 17. Closed lifecycle (covered by SIMPLE_LONG above; referenced directly in the smoke test).

// 18/19. Reversal fills stay conservative (unresolved), both directions.
export const REVERSAL_LONG_TO_SHORT: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-11T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '2', price: '20010', timestamp: '2026-09-11T10:05:00.000Z' })
]
export const REVERSAL_SHORT_TO_LONG: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Sell', quantity: '1', price: '5000', timestamp: '2026-09-12T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_ES, action: 'Buy', quantity: '2', price: '5010', timestamp: '2026-09-12T10:05:00.000Z' })
]

// 20. Reversal that halts a segment must not erase a PRIOR, already-completed
// round trip on the same (account, contract) — completed candidates before a
// later reversal stay byte-identical.
export const COMPLETED_ROUND_TRIP_THEN_REVERSAL: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-13T09:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20010', timestamp: '2026-09-13T09:05:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20020', timestamp: '2026-09-13T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '2', price: '20030', timestamp: '2026-09-13T10:05:00.000Z' })
]

// 21. Source contract identity preserved (dated contract name kept verbatim, never collapsed).
export const CONTRACT_IDENTITY_PRESERVED: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, contractName: 'MNQZ6', action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-14T10:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, contractName: 'MNQZ6', action: 'Sell', quantity: '1', price: '20010', timestamp: '2026-09-14T10:05:00.000Z' })
]

// Lifecycle-identity correction: two INDEPENDENT round trips on the SAME
// account + SAME contract must never merge into one lifecycle merely
// because (accountId, contractId) match, and the second round trip's
// identity must not depend on a position-in-sequence counter (it is keyed
// by its own opening fill id).
export const TWO_ROUND_TRIPS_SAME_ACCOUNT_AND_CONTRACT: readonly RawTradovateFill[] = [
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20000', timestamp: '2026-09-15T09:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20010', timestamp: '2026-09-15T09:05:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Sell', quantity: '1', price: '20020', timestamp: '2026-09-15T11:00:00.000Z' }),
  fill({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, action: 'Buy', quantity: '1', price: '20005', timestamp: '2026-09-15T11:05:00.000Z' })
]

// Direction-inversion regression: entry action must decide direction even
// though a naive "last fill decides" reading would call these the opposite.
export const LONG_NOT_INVERTED_BY_SELL_CLOSE = SIMPLE_LONG
export const SHORT_NOT_INVERTED_BY_BUY_CLOSE = SIMPLE_SHORT

// ---------------------------------------------------------------------------
// Reconciliation-only entities (Position, FillPair, FillFee) — official
// fields, preserved as provenance facts only. Never folded into Trade
// identity or cost accounting by this checkpoint.
// ---------------------------------------------------------------------------

export function fillPair(overrides: Partial<RawTradovateFillPair> & { readonly buyFillId: string; readonly sellFillId: string }): RawTradovateFillPair {
  return { id: null, positionId: '7001', qty: '1', buyPrice: '20000', sellPrice: '20010', active: false, ...overrides }
}

export function fillFee(overrides: Partial<RawTradovateFillFee> & { readonly id: string }): RawTradovateFillFee {
  return {
    attributedFillId: null,
    clearingFee: null,
    clearingCurrencyId: null,
    exchangeFee: null,
    exchangeCurrencyId: null,
    nfaFee: null,
    nfaCurrencyId: null,
    brokerageFee: null,
    brokerageCurrencyId: null,
    ipFee: null,
    ipCurrencyId: null,
    commission: null,
    commissionCurrencyId: null,
    orderRoutingFee: null,
    orderRoutingCurrencyId: null,
    ...overrides
  }
}

export function position(overrides: Partial<RawTradovatePosition> & { readonly accountId: string; readonly contractId: string }): RawTradovatePosition {
  return {
    id: null,
    netPos: '0',
    bought: '0',
    boughtValue: '0',
    sold: '0',
    soldValue: '0',
    prevPos: '0',
    netPrice: null,
    prevPrice: null,
    tradeDate: '2026-09-16',
    timestamp: '2026-09-16T20:00:00.000Z',
    ...overrides
  }
}

