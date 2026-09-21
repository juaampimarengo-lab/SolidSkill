/**
 * MT5 normalizer smoke suite. Pure: no MetaTrader, no sockets, no SQLite.
 * Fixtures are synthetic (invented tickets/prices/times); no real account data.
 * Run with: npm run smoke:mt5-normalizer
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MT5_PROTOCOL_VERSION, MT5_SOURCE, type RawMt5Deal } from '../../protocol'
import { buildDevSnapshot, devSnapshotDirectory, pseudonymLogin } from '../../devSnapshot'
import {
  buildStructuralReport,
  compareDealsCanonically,
  normalizeMt5Deals,
  planMt5Import,
  sourceLifecycleKey,
  type Mt5AccountContext,
  type Mt5NormalizationResult
} from '../index'

let passed = 0
let failed = 0
const lines: string[] = []

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
function check(name: string, body: () => void): void {
  try {
    body()
    passed += 1
    lines.push(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    lines.push(`FAIL  ${name}\n        ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const HEDGING: Mt5AccountContext = { server: 'Demo-Server', accountLogin: '1000002', accounting: 'RETAIL_HEDGING' }
const NETTING: Mt5AccountContext = { server: 'Demo-Server', accountLogin: '1000001', accounting: 'RETAIL_NETTING' }
const EXCHANGE: Mt5AccountContext = { ...NETTING, accounting: 'EXCHANGE' }
const T0 = 1_760_000_000_000

const BUY = 0
const SELL = 1
const IN = 0
const OUT = 1
const INOUT = 2
const OUT_BY = 3

interface D {
  t: string
  pos: string
  at?: number
  sym?: string | null
  type: number
  entry: number
  vol: string
  price: string
  profit?: string | null
  commission?: string | null
  fee?: string | null
  swap?: string | null
}

function deal(d: D, account: Mt5AccountContext = HEDGING): RawMt5Deal {
  return {
    source: MT5_SOURCE,
    protocolVersion: MT5_PROTOCOL_VERSION,
    server: account.server,
    accountLogin: account.accountLogin,
    dealTicket: d.t,
    orderTicket: `9${d.t}`,
    positionId: d.pos,
    externalId: null,
    timeMsc: d.at ?? T0 + Number(d.t) * 1000,
    symbol: d.sym === undefined ? 'EURUSD' : d.sym,
    dealType: d.type,
    dealEntry: d.entry,
    volume: d.vol,
    price: d.price,
    profit: d.profit ?? null,
    commission: d.commission ?? null,
    fee: d.fee ?? null,
    swap: d.swap ?? null,
    magic: '0',
    reason: 0
  }
}
const deals = (list: D[], account: Mt5AccountContext = HEDGING): RawMt5Deal[] => list.map((d) => deal(d, account))
const run = (list: readonly RawMt5Deal[], account: Mt5AccountContext = HEDGING): Mt5NormalizationResult =>
  normalizeMt5Deals(list, account)

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffled<T>(list: readonly T[], next: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}
const json = (r: Mt5NormalizationResult): string => JSON.stringify(r)

// Canonical scenarios ---------------------------------------------------------
const SIMPLE_LONG: D[] = [
  { t: '1', pos: '100', type: BUY, entry: IN, vol: '1', price: '1.08500', commission: '-3.5' },
  { t: '2', pos: '100', type: SELL, entry: OUT, vol: '1', price: '1.08650', profit: '150', commission: '-3.5' }
]
const SIMPLE_SHORT: D[] = [
  { t: '11', pos: '110', type: SELL, entry: IN, vol: '1', price: '1.08500' },
  { t: '12', pos: '110', type: BUY, entry: OUT, vol: '1', price: '1.08400', profit: '100' }
]
const SCALE_LONG: D[] = [
  { t: '21', pos: '120', type: BUY, entry: IN, vol: '1', price: '1.0850' },
  { t: '22', pos: '120', type: BUY, entry: IN, vol: '1', price: '1.0852' },
  { t: '23', pos: '120', type: SELL, entry: OUT, vol: '1', price: '1.0860', profit: '90' },
  { t: '24', pos: '120', type: SELL, entry: OUT, vol: '1', price: '1.0862', profit: '110' }
]
const SCALE_SHORT: D[] = [
  { t: '31', pos: '130', type: SELL, entry: IN, vol: '1', price: '1.0900' },
  { t: '32', pos: '130', type: SELL, entry: IN, vol: '1', price: '1.0902' },
  { t: '33', pos: '130', type: BUY, entry: OUT, vol: '1', price: '1.0880', profit: '20' },
  { t: '34', pos: '130', type: BUY, entry: OUT, vol: '1', price: '1.0878', profit: '24' }
]
const HEDGE_OVERLAP: D[] = [
  { t: '41', pos: '140', type: BUY, entry: IN, vol: '1', price: '1.0850' },
  { t: '42', pos: '141', type: SELL, entry: IN, vol: '1', price: '1.0849' },
  { t: '43', pos: '140', type: SELL, entry: OUT, vol: '1', price: '1.0855', profit: '50' },
  { t: '44', pos: '142', type: BUY, entry: IN, vol: '0.5', price: '1.0854' },
  { t: '45', pos: '141', type: BUY, entry: OUT, vol: '1', price: '1.0856', profit: '-70' }
]
const MULTI_SYMBOL: D[] = [
  { t: '51', pos: '150', sym: 'EURUSD', type: BUY, entry: IN, vol: '1', price: '1.0850' },
  { t: '52', pos: '151', sym: 'XAUUSD', type: SELL, entry: IN, vol: '2', price: '2400.55' },
  { t: '53', pos: '150', sym: 'EURUSD', type: SELL, entry: OUT, vol: '1', price: '1.0860', profit: '100' },
  { t: '54', pos: '151', sym: 'XAUUSD', type: BUY, entry: OUT, vol: '2', price: '2399.05', profit: '300' }
]

const only = <T>(list: readonly T[]): T => {
  assert(list.length === 1, `expected exactly one, got ${list.length}`)
  return list[0] as T
}

// ---------------------------------------------------------------------------
// 1-2. Simple lifecycles / direction rule
// ---------------------------------------------------------------------------

check('1. simple LONG: BUY IN + SELL OUT -> one completed LONG', () => {
  const r = run(deals(SIMPLE_LONG))
  const t = only(r.completed)
  equal(t.direction, 'LONG', 'direction')
  equal([t.openedQuantity, t.closedQuantity, t.remainingQuantity], ['1', '1', '0'], 'quantities')
  equal([t.avgEntryPrice, t.avgExitPrice], ['1.085', '1.0865'], 'prices')
  equal(t.executions.map((e) => e.role), ['ENTRY', 'EXIT'], 'roles')
  equal(t.executions.map((e) => e.side), ['BUY', 'SELL'], 'sides')
  assert(r.open.length === 0 && r.unresolved.length === 0, 'nothing else emitted')
})

check('2. simple SHORT: SELL IN + BUY OUT -> one completed SHORT (closing BUY does not imply LONG)', () => {
  const t = only(run(deals(SIMPLE_SHORT)).completed)
  equal(t.direction, 'SHORT', 'direction')
  equal(t.executions.map((e) => e.side), ['SELL', 'BUY'], 'sides')
})

check('2b. a position starting with an exit is NOT given a direction from the exit side', () => {
  const r = run(deals([{ t: '61', pos: '160', type: SELL, entry: OUT, vol: '1', price: '1.08' }]))
  assert(r.completed.length === 0 && r.open.length === 0, 'no trade')
  equal(only(r.unresolved).reasons, ['MISSING_OPENING_DEAL'], 'reason')
})

check('2c. direction is fixed by the opening deal even with many exits of either side present', () => {
  for (const scenario of [SIMPLE_LONG, SIMPLE_SHORT, SCALE_LONG, SCALE_SHORT]) {
    const t = only(run(deals(scenario)).completed)
    const opening = t.executions[0]
    assert(opening !== undefined && opening.role === 'ENTRY', 'first execution is the entry')
    equal(t.direction, opening.side === 'BUY' ? 'LONG' : 'SHORT', 'direction == opening side')
  }
})

// ---------------------------------------------------------------------------
// 3-5. Scale in/out, partial exits
// ---------------------------------------------------------------------------

check('3. LONG scale-in/out: one Trade, four Executions, exact weighted averages', () => {
  const t = only(run(deals(SCALE_LONG)).completed)
  equal(t.direction, 'LONG', 'direction')
  equal(t.executions.length, 4, 'executions')
  equal([t.openedQuantity, t.remainingQuantity], ['2', '0'], 'quantities')
  equal([t.avgEntryPrice, t.avgEntryPriceExact], ['1.0851', true], 'entry avg')
  equal([t.avgExitPrice, t.avgExitPriceExact], ['1.0861', true], 'exit avg')
  equal(t.grossPnl, '200', 'gross is the sum of reported profit')
  equal(t.executions.map((e) => e.sequence), [1, 2, 3, 4], 'sequence')
})

check('4. SHORT scale-in/out: one SHORT Trade', () => {
  const t = only(run(deals(SCALE_SHORT)).completed)
  equal(t.direction, 'SHORT', 'direction')
  equal(t.executions.length, 4, 'executions')
  equal([t.avgEntryPrice, t.avgExitPrice], ['1.0901', '1.0879'], 'averages')
})

check('4b. non-terminating weighted average is rounded half-up and flagged inexact', () => {
  const t = only(
    run(
      deals([
        { t: '71', pos: '170', type: BUY, entry: IN, vol: '1', price: '1.00000000' },
        { t: '72', pos: '170', type: BUY, entry: IN, vol: '2', price: '1.00000001' },
        { t: '73', pos: '170', type: SELL, entry: OUT, vol: '3', price: '1.5' }
      ])
    ).completed
  )
  equal([t.avgEntryPrice, t.avgEntryPriceExact], ['1.00000001', false], 'rounding disclosed')
})

check('5. partial exit stays OPEN with remaining quantity, then completes when flat', () => {
  const partial: D[] = [
    { t: '81', pos: '180', type: BUY, entry: IN, vol: '2', price: '1.0850' },
    { t: '82', pos: '180', type: SELL, entry: OUT, vol: '1', price: '1.0860', profit: '100' }
  ]
  const r = run(deals(partial))
  assert(r.completed.length === 0, 'must not be emitted as a closed Trade')
  const open = only(r.open)
  equal([open.direction, open.openedQuantity, open.closedQuantity, open.remainingQuantity], ['LONG', '2', '1', '1'], 'open state')
  equal(open.grossPnl, '100', 'realized so far')
  const done = run(deals([...partial, { t: '83', pos: '180', type: SELL, entry: OUT, vol: '1', price: '1.0870', profit: '200' }]))
  assert(done.open.length === 0, 'no longer open')
  const t = only(done.completed)
  equal([t.remainingQuantity, t.sourceLifecycleKey], ['0', open.sourceLifecycleKey], 'same lifecycle identity, now completed')
})

// ---------------------------------------------------------------------------
// 6-7. Hedging identity
// ---------------------------------------------------------------------------

check('6. hedging: overlapping same-symbol positions stay independent lifecycles', () => {
  const r = run(deals(HEDGE_OVERLAP))
  equal(r.completed.map((t) => [t.sourcePositionId, t.direction]), [['140', 'LONG'], ['141', 'SHORT']], 'two independent trades')
  equal(only(r.open).sourcePositionId, '142', 'third position still open')
  const keys = new Set([...r.completed, ...r.open].map((t) => t.sourceLifecycleKey))
  assert(keys.size === 3, 'distinct identities')
})

check('7. multiple symbols are independent', () => {
  const r = run(deals(MULTI_SYMBOL))
  equal(r.completed.map((t) => [t.symbol, t.direction]), [['EURUSD', 'LONG'], ['XAUUSD', 'SHORT']], 'trades')
})

// ---------------------------------------------------------------------------
// 8-10. Determinism, duplicates, ties
// ---------------------------------------------------------------------------

check('8. out-of-order arrival yields a byte-identical result (all canonical scenarios, 25 shuffles each)', () => {
  const all = deals([...SIMPLE_LONG, ...SIMPLE_SHORT, ...SCALE_LONG, ...SCALE_SHORT, ...HEDGE_OVERLAP, ...MULTI_SYMBOL])
  const baseline = json(run(all))
  const next = rng(12345)
  for (let i = 0; i < 25; i++) equal(json(run(shuffled(all, next))), baseline, `shuffle ${i}`)
  assert(baseline.includes('"COMPLETED"'), 'baseline is non-trivial')
})

check('9. duplicate raw deal input: counted once, explicit diagnostic', () => {
  const base = deals(SIMPLE_LONG)
  const r = run([...base, base[0] as RawMt5Deal, { ...(base[1] as RawMt5Deal) }])
  const t = only(r.completed)
  equal(t.executions.length, 2, 'no duplicated execution')
  equal(r.stats.duplicateDealsDropped, 2, 'dropped count')
  assert(r.diagnostics.some((d) => d.code === 'DUPLICATE_DEAL_IGNORED'), 'diagnostic emitted')
  equal(json(r).includes('"DEAL_CONFLICT"'), false, 'not a conflict')
})

check('9b. same identity with DIFFERENT facts: all versions withheld, lifecycle unresolved', () => {
  const base = deals(SIMPLE_LONG)
  const altered = { ...(base[1] as RawMt5Deal), price: '9.99999' }
  const r = run([...base, altered])
  assert(r.completed.length === 0, 'no trade from contradictory facts')
  equal(only(r.rejected).reason, 'DEAL_CONFLICT', 'rejected')
  assert(only(r.unresolved).reasons.includes('DEAL_CONFLICT'), 'lifecycle withheld')
  equal(json(run([altered, ...base])), json(r), 'order independent')
})

check('10. identical timestamp: numeric deal-ticket tie-break, stable under shuffling', () => {
  const same: D[] = [
    { t: '99', pos: '190', at: T0, type: BUY, entry: IN, vol: '1', price: '1.1' },
    { t: '100', pos: '190', at: T0, type: SELL, entry: OUT, vol: '1', price: '1.2', profit: '5' }
  ]
  const list = deals(same)
  equal([...list].sort(compareDealsCanonically).map((d) => d.dealTicket), ['99', '100'], 'numeric, not lexicographic ("100" < "99" as text)')
  const next = rng(7)
  const baseline = json(run(list))
  for (let i = 0; i < 10; i++) equal(json(run(shuffled(list, next))), baseline, 'stable')
  equal(only(run(list).completed).direction, 'LONG', 'entry processed first')
})

// ---------------------------------------------------------------------------
// 11-14. Ignored / rejected / impossible
// ---------------------------------------------------------------------------

check('11. non-trading deal types are ignored, never Trades', () => {
  const r = run(
    deals([
      { t: '201', pos: '0', sym: null, type: 2, entry: IN, vol: '0', price: '0', profit: '1000' },
      { t: '202', pos: '0', sym: null, type: 3, entry: IN, vol: '0', price: '0' },
      { t: '203', pos: '0', sym: null, type: 7, entry: IN, vol: '0', price: '0', commission: '-2' },
      { t: '204', pos: '0', sym: null, type: 5, entry: IN, vol: '0', price: '0' }
    ])
  )
  equal(r.ignored.map((i) => i.dealTypeLabel), ['BALANCE', 'CREDIT', 'COMMISSION', 'CORRECTION'], 'classified')
  assert(r.completed.length + r.open.length + r.unresolved.length === 0, 'no lifecycle')
})

check('12. unknown DEAL_TYPE is rejected with a diagnostic, never read as BUY/SELL', () => {
  const r = run(deals([{ t: '211', pos: '0', type: 200, entry: IN, vol: '1', price: '1.1' }]))
  equal(only(r.rejected).reason, 'UNKNOWN_DEAL_TYPE', 'rejected')
  assert(r.completed.length + r.open.length === 0, 'no trade')
  assert(r.diagnostics.some((d) => d.code === 'UNKNOWN_DEAL_TYPE' && d.severity === 'error'), 'diagnostic')
})

check('12b. cancelled deals and unsupported DEAL_ENTRY values withhold the lifecycle', () => {
  const canceled = run(deals([...SIMPLE_LONG, { t: '221', pos: '100', type: 13, entry: IN, vol: '1', price: '1.085' }]))
  assert(canceled.completed.length === 0, 'no trade')
  assert(only(canceled.unresolved).reasons.includes('CANCELED_DEAL_PRESENT'), 'withheld')
  const state = run(deals([...SIMPLE_LONG, { t: '222', pos: '100', type: BUY, entry: 9, vol: '1', price: '1.085' }]))
  equal(only(state.rejected).reason, 'UNSUPPORTED_DEAL_ENTRY', 'unsupported entry rejected')
  assert(state.completed.length === 0, 'lifecycle withheld, not silently completed')
})

check('13. impossible over-close: diagnostic, unresolved, remaining NOT forced to zero', () => {
  const r = run(
    deals([
      { t: '231', pos: '230', type: BUY, entry: IN, vol: '1', price: '1.1' },
      { t: '232', pos: '230', type: SELL, entry: OUT, vol: '2', price: '1.2', profit: '5' }
    ])
  )
  assert(r.completed.length === 0 && r.open.length === 0, 'no fake Trade')
  const u = only(r.unresolved)
  equal([u.reasons, u.remainingQuantity], [['OVER_CLOSE'], '1'], 'state preserved')
})

check('13b. inconsistent sequences are withheld (entry against direction, exit with direction, reopen, symbol change)', () => {
  const bad = (list: D[]): string[] => only(run(deals(list)).unresolved).reasons as string[]
  equal(bad([
    { t: '241', pos: '240', type: BUY, entry: IN, vol: '1', price: '1.1' },
    { t: '242', pos: '240', type: SELL, entry: IN, vol: '1', price: '1.1' }
  ]), ['ENTRY_AGAINST_DIRECTION'], 'entry against')
  equal(bad([
    { t: '243', pos: '241', type: BUY, entry: IN, vol: '2', price: '1.1' },
    { t: '244', pos: '241', type: BUY, entry: OUT, vol: '1', price: '1.1' }
  ]), ['EXIT_WITH_DIRECTION'], 'exit with')
  equal(bad([...SIMPLE_LONG, { t: '245', pos: '100', type: BUY, entry: IN, vol: '1', price: '1.1' }]), ['REOPEN_AFTER_CLOSE'], 'reopen')
  equal(bad([
    { t: '246', pos: '242', sym: 'EURUSD', type: BUY, entry: IN, vol: '1', price: '1.1' },
    { t: '247', pos: '242', sym: 'GBPUSD', type: SELL, entry: OUT, vol: '1', price: '1.1' }
  ]), ['SYMBOL_MISMATCH'], 'symbol')
})

check('14. zero / invalid quantity, price, decimal, symbol, position id are rejected', () => {
  const r = run(
    deals([
      { t: '251', pos: '250', type: BUY, entry: IN, vol: '0', price: '1.1' },
      { t: '252', pos: '251', type: BUY, entry: IN, vol: '-1', price: '1.1' },
      { t: '253', pos: '252', type: BUY, entry: IN, vol: '1', price: '0' },
      { t: '254', pos: '253', type: BUY, entry: IN, vol: '1e3', price: '1.1' },
      { t: '255', pos: '254', sym: null, type: BUY, entry: IN, vol: '1', price: '1.1' },
      { t: '256', pos: '0', type: BUY, entry: IN, vol: '1', price: '1.1' }
    ])
  )
  equal(r.rejected.map((x) => x.reason), ['INVALID_QUANTITY', 'INVALID_QUANTITY', 'INVALID_PRICE', 'INVALID_DECIMAL', 'MISSING_SYMBOL', 'MISSING_POSITION_ID'], 'reasons')
  assert(r.completed.length + r.open.length === 0, 'no trade')
  equal(r.unresolved.length, 5, 'positions with a rejected deal are withheld (the position-less one cannot be)')
})

// ---------------------------------------------------------------------------
// 15-16. Costs
// ---------------------------------------------------------------------------

check('15. commission / fee / swap stay distinct; net = gross + costs; per-execution values preserved', () => {
  const t = only(
    run(
      deals([
        { t: '301', pos: '300', type: BUY, entry: IN, vol: '1', price: '1.0850', profit: '0', commission: '-3.50', fee: '-0.25', swap: '-1.2' },
        { t: '302', pos: '300', type: SELL, entry: OUT, vol: '1', price: '1.0860', profit: '100.00', commission: null, fee: '0.00000000', swap: null }
      ])
    ).completed
  )
  equal([t.grossPnl, t.commission, t.fees, t.swap, t.netPnl], ['100', '-3.5', '-0.25', '-1.2', '95.05'], 'trade totals')
  const [entry, exit] = t.executions
  equal([entry?.commission, entry?.fees, entry?.swap], ['-3.5', '-0.25', '-1.2'], 'entry costs')
  equal([exit?.commission, exit?.fees, exit?.swap], [null, '0', null], 'exit: null stays null, reported zero stays 0')
})

check('16. null vs zero: unreported categories stay null on the Trade; reported zeros stay 0', () => {
  const allNull = only(run(deals(SIMPLE_SHORT)).completed)
  equal([allNull.commission, allNull.fees, allNull.swap], [null, null, null], 'nothing invented')
  equal(allNull.netPnl, '100', 'net counts null as 0 only inside the sum')
  const zeros = only(
    run(
      deals([
        { t: '311', pos: '310', type: BUY, entry: IN, vol: '1', price: '1.1', profit: '0', commission: '0', fee: '0', swap: '0' },
        { t: '312', pos: '310', type: SELL, entry: OUT, vol: '1', price: '1.1', profit: '0', commission: '0', fee: '0', swap: '0' }
      ])
    ).completed
  )
  equal([zeros.grossPnl, zeros.commission, zeros.fees, zeros.swap, zeros.netPnl], ['0', '0', '0', '0', '0'], 'zeros preserved')
  const noProfit = only(
    run(
      deals([
        { t: '313', pos: '311', type: BUY, entry: IN, vol: '1', price: '1.1' },
        { t: '314', pos: '311', type: SELL, entry: OUT, vol: '1', price: '1.1', commission: '-1' }
      ])
    ).completed
  )
  equal([noProfit.grossPnl, noProfit.netPnl], [null, null], 'no reported profit -> gross and net unknown, not zero')
})

check('16b. arithmetic is exact (0.1 + 0.2 = 0.3; no binary floating point)', () => {
  const t = only(
    run(
      deals([
        { t: '321', pos: '320', type: BUY, entry: IN, vol: '2', price: '1.1' },
        { t: '322', pos: '320', type: SELL, entry: OUT, vol: '1', price: '1.1', profit: '0.1', commission: '-0.1' },
        { t: '323', pos: '320', type: SELL, entry: OUT, vol: '1', price: '1.1', profit: '0.2', commission: '-0.2' }
      ])
    ).completed
  )
  equal([t.grossPnl, t.commission, t.netPnl], ['0.3', '-0.3', '0'], 'exact')
})

// ---------------------------------------------------------------------------
// 17-19. Netting, INOUT, OUT_BY
// ---------------------------------------------------------------------------

check('17. simple netting/exchange IN/OUT reconstructs (documented semantics only)', () => {
  for (const account of [NETTING, EXCHANGE]) {
    const r = run(deals(SIMPLE_LONG, account), account)
    equal(only(r.completed).direction, 'LONG', `${account.accounting} long`)
    const s = run(deals(SIMPLE_SHORT, account), account)
    equal(only(s.completed).direction, 'SHORT', `${account.accounting} short`)
  }
})

check('17b. netting: overlapping same-symbol lifecycles contradict the platform model and are withheld (hedging allows them)', () => {
  const overlap: D[] = [
    { t: '401', pos: '400', type: BUY, entry: IN, vol: '1', price: '1.1' },
    { t: '402', pos: '401', type: SELL, entry: IN, vol: '1', price: '1.1' },
    { t: '403', pos: '400', type: SELL, entry: OUT, vol: '1', price: '1.1', profit: '1' },
    { t: '404', pos: '401', type: BUY, entry: OUT, vol: '1', price: '1.1', profit: '1' }
  ]
  const n = run(deals(overlap, NETTING), NETTING)
  equal(n.unresolved.map((u) => u.reasons), [['NETTING_SYMBOL_OVERLAP'], ['NETTING_SYMBOL_OVERLAP']], 'withheld')
  equal(run(deals(overlap)).completed.length, 2, 'fine under hedging')
  const sequential: D[] = [SIMPLE_LONG[0] as D, SIMPLE_LONG[1] as D, { t: '405', pos: '402', type: SELL, entry: IN, vol: '1', price: '1.1' }, { t: '406', pos: '402', type: BUY, entry: OUT, vol: '1', price: '1.1', profit: '1' }]
  equal(run(deals(sequential, NETTING), NETTING).completed.length, 2, 'back-to-back positions are fine')
})

check('18. netting INOUT reversal stays explicitly unresolved / NOT production-proven, with split preserved', () => {
  const r = run(
    deals(
      [
        { t: '411', pos: '410', type: BUY, entry: IN, vol: '1', price: '1.0850' },
        { t: '412', pos: '410', type: SELL, entry: INOUT, vol: '2', price: '1.0860', profit: '100' }
      ],
      NETTING
    ),
    NETTING
  )
  assert(r.completed.length === 0 && r.open.length === 0, 'no Trade emitted, no guessed segmentation')
  const u = only(r.unresolved)
  equal(u.reasons, ['INOUT_NOT_PRODUCTION_PROVEN'], 'reason')
  const obs = only(u.inout)
  equal([obs.priorDirection, obs.priorRemainingQuantity, obs.candidateClosingQuantity, obs.candidateReversalQuantity], ['LONG', '1', '1', '1'], 'closing/reversal portions identified but not applied')
  assert(u.needs.length > 0, 'states what is needed')
  assert(r.diagnostics.some((d) => d.code === 'INOUT_NOT_PRODUCTION_PROVEN'), 'diagnostic')
})

check('18b. INOUT under hedging and a leading INOUT are also withheld', () => {
  const r = run(deals([...SIMPLE_LONG, { t: '421', pos: '420', type: SELL, entry: INOUT, vol: '1', price: '1.1' }]))
  equal(r.completed.length, 1, 'unrelated lifecycle unaffected')
  const u = only(r.unresolved)
  equal([u.reasons, only(u.inout).priorDirection], [['INOUT_NOT_PRODUCTION_PROVEN'], null], 'unknown prior state stays null')
})

check('19. OUT_BY is explicitly unsupported and does not corrupt other positions', () => {
  const r = run(
    deals([
      { t: '431', pos: '430', type: BUY, entry: IN, vol: '1', price: '1.1' },
      { t: '432', pos: '431', type: SELL, entry: IN, vol: '1', price: '1.1' },
      { t: '433', pos: '430', type: SELL, entry: OUT_BY, vol: '1', price: '1.1', profit: '0' },
      { t: '434', pos: '431', type: BUY, entry: OUT_BY, vol: '1', price: '1.1', profit: '0' },
      ...SIMPLE_LONG
    ])
  )
  equal(r.completed.map((t) => t.sourcePositionId), ['100'], 'only the unrelated position completes')
  equal(r.unresolved.map((u) => [u.sourcePositionId, u.reasons]), [['430', ['OUT_BY_UNSUPPORTED']], ['431', ['OUT_BY_UNSUPPORTED']]], 'both sides withheld')
  assert(only(r.unresolved.slice(0, 1)).needs.some((n) => n.includes('counter')), 'names the missing fact')
})

check('19b. unknown accounting mode withholds everything; foreign-account deals are excluded', () => {
  const unknown = run(deals(SIMPLE_LONG), { ...HEDGING, accounting: null })
  assert(unknown.completed.length === 0, 'nothing reconstructed')
  equal(only(unknown.unresolved).reasons, ['ACCOUNTING_MODE_UNKNOWN'], 'reason')
  const foreign = run([...deals(SIMPLE_LONG), ...deals(SIMPLE_SHORT, NETTING)])
  equal(foreign.completed.length, 1, 'only this account')
  equal(foreign.ignored.filter((i) => i.reason === 'ACCOUNT_MISMATCH').length, 2, 'foreign deals ignored, explicitly')
})

// ---------------------------------------------------------------------------
// 20. Replay / reconciliation / identity
// ---------------------------------------------------------------------------

check('20. replay: same deals -> same candidates; old + new deals -> old candidates unchanged', () => {
  const old = deals([...SIMPLE_LONG, ...SCALE_LONG, ...SIMPLE_SHORT, { t: '501', pos: '500', type: BUY, entry: IN, vol: '2', price: '1.1' }, { t: '502', pos: '500', type: SELL, entry: OUT, vol: '1', price: '1.2', profit: '10' }])
  const first = run(old)
  equal(json(run(old)), json(first), 'idempotent')
  assert(first.completed.length === 3 && first.open.length === 1, 'baseline: 3 completed + 1 open')

  // The open lifecycle progresses and a brand-new lifecycle completes.
  const added = deals([
    { t: '503', pos: '500', type: SELL, entry: OUT, vol: '1', price: '1.3', profit: '20' },
    { t: '504', pos: '510', type: BUY, entry: IN, vol: '1', price: '1.1' },
    { t: '505', pos: '510', type: SELL, entry: OUT, vol: '1', price: '1.2', profit: '5' }
  ])
  const second = run([...old, ...added])
  for (const c of first.completed) {
    const again = second.completed.find((x) => x.sourceLifecycleKey === c.sourceLifecycleKey)
    equal(JSON.stringify(again), JSON.stringify(c), 'previously completed candidate unchanged')
  }
  equal(second.open.length, 0, 'open lifecycle closed')
  equal(second.completed.length, 5, 'plus progressed and new lifecycles')
  const progressed = second.completed.find((x) => x.sourcePositionId === '500')
  equal(progressed?.sourceLifecycleKey, first.open[0]?.sourceLifecycleKey, 'progressed lifecycle keeps its identity')

  const plan = planMt5Import(second, new Set(first.completed.map((c) => c.sourceLifecycleKey)))
  equal([plan.toCreate.length, plan.alreadyImported.length], [2, 3], 'no duplicate analytical candidates')
  const stale = planMt5Import(first, new Set())
  equal([stale.toCreate.length, stale.withheldOpen], [3, 1], 'open lifecycle is withheld from import')
})

check('20b. source lifecycle identity = MT5 + server + account + positionId, independent of other deals', () => {
  const alone = only(run(deals(SIMPLE_LONG)).completed)
  const crowded = run(deals([...SCALE_SHORT, ...SIMPLE_LONG, ...MULTI_SYMBOL])).completed.find((t) => t.sourcePositionId === '100')
  equal(alone.sourceLifecycleKey, JSON.stringify(['MT5', 'Demo-Server', '1000002', '100']), 'shape')
  equal(alone.sourceLifecycleKey, sourceLifecycleKey('Demo-Server', '1000002', '100'), 'helper agrees')
  equal(crowded?.sourceLifecycleKey, alone.sourceLifecycleKey, 'stable')
  for (const e of alone.executions) assert(e.sourceExecutionKey === JSON.stringify(['MT5', 'Demo-Server', '1000002', e.dealTicket]), 'execution identity is the source deal identity')
  const other = normalizeMt5Deals(deals(SIMPLE_LONG, { ...HEDGING, accountLogin: '1000003' }), { ...HEDGING, accountLogin: '1000003' })
  assert(only(other.completed).sourceLifecycleKey !== alone.sourceLifecycleKey, 'different account -> different key')
})

// ---------------------------------------------------------------------------
// Property / invariant tests (seeded random hedging books)
// ---------------------------------------------------------------------------

function randomBook(seed: number): D[] {
  const next = rng(seed)
  const out: D[] = []
  let ticket = 1000
  let clock = 0
  const symbols = ['EURUSD', 'GBPUSD', 'XAUUSD']
  const positionCount = 4 + Math.floor(next() * 6)
  const perPosition: D[][] = []
  for (let p = 0; p < positionCount; p++) {
    const long = next() < 0.5
    const sym = symbols[Math.floor(next() * symbols.length)] as string
    const pos = String(7000 + p)
    const qtyChoices = ['1', '2', '0.5', '0.25']
    const entryCount = 1 + Math.floor(next() * 3)
    const list: D[] = []
    let total = 0
    for (let i = 0; i < entryCount; i++) {
      const q = qtyChoices[Math.floor(next() * qtyChoices.length)] as string
      total += Number(q)
      list.push({ t: '', pos, sym, type: long ? BUY : SELL, entry: IN, vol: q, price: (1 + Math.floor(next() * 9000) / 10000).toFixed(4), commission: '-0.5' })
    }
    let left = total
    const closeFully = next() < 0.7
    const target = closeFully ? total : total / 2
    while (left > total - target + 1e-9) {
      const q = Math.min(left - (total - target), Number(qtyChoices[Math.floor(next() * qtyChoices.length)]))
      const rounded = Math.max(0.25, Math.round(q * 4) / 4)
      const take = Math.min(rounded, left - (total - target))
      if (take <= 0) break
      left -= take
      list.push({ t: '', pos, sym, type: long ? SELL : BUY, entry: OUT, vol: String(take), price: (1 + Math.floor(next() * 9000) / 10000).toFixed(4), profit: String(Math.floor(next() * 200) - 100), commission: '-0.5' })
    }
    perPosition.push(list)
  }
  // interleave while keeping each position's own order
  const cursors = perPosition.map(() => 0)
  for (;;) {
    const live = cursors.map((c, i) => (c < (perPosition[i] as D[]).length ? i : -1)).filter((i) => i >= 0)
    if (live.length === 0) break
    const pick = live[Math.floor(next() * live.length)] as number
    const d = (perPosition[pick] as D[])[cursors[pick] as number] as D
    cursors[pick] = (cursors[pick] as number) + 1
    ticket += 1 + Math.floor(next() * 3)
    clock += 1 + Math.floor(next() * 5000)
    out.push({ ...d, t: String(ticket), at: T0 + clock })
  }
  return out
}

check('property: 200 random hedging books satisfy the lifecycle invariants under shuffling', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const book = deals(randomBook(seed))
    const r = run(book)
    const again = run(shuffled(book, rng(seed * 31)))
    equal(json(again), json(r), `seed ${seed}: order independent`)
    const claimed = new Set<string>()
    let participating = 0
    for (const c of [...r.completed, ...r.open]) {
      const entry = c.executions[0]
      assert(entry !== undefined && entry.role === 'ENTRY', `seed ${seed}: opens with an entry`)
      equal(c.direction, entry.side === 'BUY' ? 'LONG' : 'SHORT', `seed ${seed}: direction from the opening side`)
      let inQty = 0n
      let outQty = 0n
      for (const e of c.executions) {
        const scaled = BigInt(Math.round(Number(e.quantity) * 1e8))
        if (e.role === 'ENTRY') inQty += scaled
        else outQty += scaled
        assert(e.dealTicket.length > 0 && e.sourceExecutionKey.includes(e.dealTicket), `seed ${seed}: source deal identity kept`)
        assert(!claimed.has(e.dealTicket), `seed ${seed}: deal ${e.dealTicket} belongs to exactly one candidate`)
        claimed.add(e.dealTicket)
        participating += 1
        equal(e.role === 'EXIT' ? e.side !== (c.direction === 'LONG' ? 'BUY' : 'SELL') : e.side === (c.direction === 'LONG' ? 'BUY' : 'SELL'), true, `seed ${seed}: exits oppose direction`)
      }
      equal(String(Math.round(Number(c.openedQuantity) * 1e8)), String(inQty), `seed ${seed}: opened == sum(entries)`)
      equal(String(Math.round(Number(c.closedQuantity) * 1e8)), String(outQty), `seed ${seed}: closed == sum(exits)`)
      if (c.status === 'COMPLETED') equal(c.remainingQuantity, '0', `seed ${seed}: completed is flat`)
      else assert(Number(c.remainingQuantity) > 0, `seed ${seed}: open has remaining > 0`)
    }
    equal(participating, book.length, `seed ${seed}: every trading deal participates in exactly one candidate`)
    equal(r.unresolved.length + r.rejected.length, 0, `seed ${seed}: generator only produces valid books`)
  }
})

// ---------------------------------------------------------------------------
// Diagnostics, boundaries, dev snapshot
// ---------------------------------------------------------------------------

check('structural report: counts and masked identity only', () => {
  const book = deals([...SIMPLE_LONG, ...SCALE_SHORT, { t: '601', pos: '0', sym: null, type: 2, entry: IN, vol: '0', price: '0' }, { t: '602', pos: '600', type: SELL, entry: INOUT, vol: '1', price: '1.1' }])
  const r = run(book)
  const report = buildStructuralReport(book, r)
  equal([report.totalRawDeals, report.tradingDeals, report.nonTradingDeals, report.uniquePositionIds], [8, 7, 1, 3], 'counts')
  equal([report.completedLifecycles, report.unresolvedLifecycles, report.inoutDeals, report.outByDeals], [2, 1, 1, 0], 'lifecycles')
  equal(report.dealEntryDistribution, { IN: 3, OUT: 3, INOUT: 1 }, 'DEAL_ENTRY distribution')
  equal(report.account, '***002', 'masked')
  assert(!JSON.stringify(report).includes('1000002'), 'login never appears in full')
})

check('dev snapshot: pseudonymized identity, structure-preserving, controlled path', () => {
  const book = deals([...SIMPLE_LONG, ...HEDGE_OVERLAP])
  const snapshot = buildDevSnapshot({ server: HEDGING.server, login: HEDGING.accountLogin, accounting: 'RETAIL_HEDGING' }, book, '2026-01-01T00:00:00.000Z')
  const text = JSON.stringify(snapshot)
  assert(!text.includes('1000002') && !text.includes('Demo-Server'), 'real login/server absent')
  equal(snapshot.account.accountLogin, pseudonymLogin('1000002'), 'stable pseudonym')
  assert(/^\d+$/.test(snapshot.account.accountLogin), 'digits only')
  const account: Mt5AccountContext = { server: snapshot.account.server, accountLogin: snapshot.account.accountLogin, accounting: 'RETAIL_HEDGING' }
  const shape = (r: Mt5NormalizationResult): unknown => r.completed.map((t) => [t.sourcePositionId, t.direction, t.avgEntryPrice, t.netPnl])
  equal(shape(run(snapshot.deals, account)), shape(run(book)), 'anonymization does not change lifecycle structure')
  assert(devSnapshotDirectory('/repo').replace(/\\/g, '/').endsWith('/repo/.dev-data/mt5'), 'fixed development directory')
  assert(readFileSync(resolve('.gitignore'), 'utf8').includes('.dev-data/'), '.dev-data is gitignored')
})

check('isolation: the normalizer imports no Electron/SQLite/IPC/Strategy code and names no methodology', () => {
  const dir = resolve('src/main/integrations/mt5/normalizer')
  const forbidden = [/from 'electron'/, /persistence\/(database|repositories|migrator|sql)/, /\/ipc\//, /strategies\//, /trading\//, /node:(net|child_process|fs)/]
  const methodology = /\b(ICT|CRT|SMT|VWAP|FVG|liquidity|sweep|opening range|bias)\b/i
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(dir, file), 'utf8')
    for (const re of forbidden) assert(!re.test(src), `${file} matches forbidden import ${re}`)
    assert(!methodology.test(src), `${file} mentions a methodology concept`)
    assert(!/OrderSend|CTrade|OrderCancel|PositionClose/i.test(src), `${file} references trade execution`)
  }
})

for (const line of lines) console.log(line)
console.log(`\nmt5-normalizer smoke: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
