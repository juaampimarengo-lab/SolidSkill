/**
 * MT5 Import Service smoke suite. Fixtures are synthetic (invented tickets,
 * prices, times, account). No MetaTrader, no sockets, no real data. Uses a
 * throwaway in-memory SQLite. Run with: npm run smoke:mt5-import
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from '../../../../persistence'
import { TradingService } from '../../../../trading/tradingService'
import { MT5_PROTOCOL_VERSION, MT5_SOURCE, type RawMt5Deal } from '../../protocol'
import { buildDevSnapshot, devSnapshotDirectory, isPseudonymizedSnapshotAccount } from '../../devSnapshot'
import type { Mt5AccountStatus, Mt5ReceiverStatus } from '../../receiver'
import type { StagedDeal } from '../../rawDealStaging'
import { importFromLiveStaging, isDevelopmentDatabasePath, type LiveStagingSource } from '../liveImport'
import { buildPersistedReport } from '../importReport'
import {
  LIVE_IMPORT_ACTION,
  LIVE_IMPORT_CONFIRMATION,
  LIVE_IMPORT_REQUEST_FILE,
  LIVE_IMPORT_RESULT_FILE,
  startDevImportGate,
  startDevImportGateFromEnvironment
} from '../devImportGate'
import { normalizeMt5Deals, type CompletedTradeCandidate, type Mt5AccountContext, type Mt5NormalizationResult } from '../../normalizer'
import {
  MT5_PLATFORM,
  Mt5ImportService,
  maskLogin,
  mt5AnalyticalDate,
  mt5SourceAccountId,
  type Mt5ImportResult
} from '../mt5ImportService'

let passed = 0
let failed = 0
const lines: string[] = []

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function equal<T>(actual: T, expected: T, message = 'values differ'): void {
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

// ---- fixtures ---------------------------------------------------------------
const ACCOUNT: Mt5AccountContext = { server: 'Demo-Server', accountLogin: '1000002', accounting: 'RETAIL_HEDGING' }
const T0 = Date.UTC(2026, 0, 5, 10, 0, 0)
const BUY = 0
const SELL = 1
const IN = 0
const OUT = 1
const INOUT = 2
const OUT_BY = 3
const BALANCE = 2

interface D {
  t: string
  pos: string
  at?: number
  sym?: string
  type: number
  entry: number
  vol?: string
  price?: string
  profit?: string | null
  commission?: string | null
  fee?: string | null
  swap?: string | null
}
function deal(d: D): RawMt5Deal {
  return {
    source: MT5_SOURCE,
    protocolVersion: MT5_PROTOCOL_VERSION,
    server: ACCOUNT.server,
    accountLogin: ACCOUNT.accountLogin,
    dealTicket: d.t,
    orderTicket: `9${d.t}`,
    positionId: d.pos,
    externalId: null,
    timeMsc: d.at ?? T0 + Number(d.t) * 1000,
    symbol: d.sym ?? 'EURUSD',
    dealType: d.type,
    dealEntry: d.entry,
    volume: d.vol ?? '1',
    price: d.price ?? '1.0850',
    profit: d.profit ?? null,
    commission: d.commission ?? null,
    fee: d.fee ?? null,
    swap: d.swap ?? null,
    magic: '0',
    reason: 0
  }
}
const norm = (list: D[]): Mt5NormalizationResult => normalizeMt5Deals(list.map(deal), ACCOUNT)

const LONG: D[] = [
  { t: '1', pos: '100', type: BUY, entry: IN, price: '1.08500', commission: '-3.5' },
  { t: '2', pos: '100', type: SELL, entry: OUT, price: '1.08650', profit: '150', commission: '-3.5' }
]
const SHORT: D[] = [
  { t: '11', pos: '110', sym: 'XAUUSD.x', type: SELL, entry: IN, price: '2400.50' },
  { t: '12', pos: '110', sym: 'XAUUSD.x', type: BUY, entry: OUT, price: '2399.50', profit: '100' }
]
const SCALE: D[] = [
  { t: '21', pos: '120', type: BUY, entry: IN, price: '1.0850' },
  { t: '22', pos: '120', type: BUY, entry: IN, price: '1.0852' },
  { t: '23', pos: '120', type: SELL, entry: OUT, price: '1.0860', profit: '90' },
  { t: '24', pos: '120', type: SELL, entry: OUT, price: '1.0862', profit: '110' }
]
const OPEN_PARTIAL: D[] = [
  { t: '31', pos: '130', type: BUY, entry: IN, vol: '2' },
  { t: '32', pos: '130', type: SELL, entry: OUT, vol: '1', profit: '10' }
]
const HEDGED: D[] = [
  { t: '41', pos: '140', type: BUY, entry: IN },
  { t: '42', pos: '141', type: SELL, entry: IN },
  { t: '43', pos: '140', type: SELL, entry: OUT, profit: '50' },
  { t: '44', pos: '141', type: BUY, entry: OUT, profit: '-70' }
]
const OTHER_SYMBOLS: D[] = [
  { t: '51', pos: '150', sym: 'EURUSD', type: BUY, entry: IN },
  { t: '52', pos: '151', sym: 'GBPJPY', type: SELL, entry: IN, price: '190.10' },
  { t: '53', pos: '150', sym: 'EURUSD', type: SELL, entry: OUT, profit: '100' },
  { t: '54', pos: '151', sym: 'GBPJPY', type: BUY, entry: OUT, price: '189.90', profit: '300' }
]
const NEW_ONE: D[] = [
  { t: '61', pos: '160', type: BUY, entry: IN },
  { t: '62', pos: '160', type: SELL, entry: OUT, profit: '5' }
]

const fresh = (): { db: Database; svc: Mt5ImportService; trading: TradingService } => {
  const db = Database.open(':memory:')
  return { db, svc: new Mt5ImportService(db), trading: new TradingService(db) }
}
const OPTS = { currency: 'USD' } as const
const counts = (r: Mt5ImportResult): [number, number, number, number] => [
  r.created.length,
  r.alreadyExisting.length,
  r.conflicts.length,
  r.failed.length
]
const rowCount = (db: Database, table: string): number => {
  if (table === 'trades') return db.repositories.trades.list().length
  if (table === 'accounts') return db.repositories.accounts.list({ includeArchived: true }).length
  let n = 0
  for (const t of db.repositories.trades.list()) n += db.repositories.trades.listExecutions(t.id).length
  return n
}
const tradeBy = (db: Database, pos: string) => {
  const found = db.repositories.trades.list().filter((t) => t.sourcePositionId === pos)
  assert(found.length === 1, `expected one trade for position ${pos}, got ${found.length}`)
  return found[0]!
}

// ---- 1-3 direction / scale ----------------------------------------------------
check('1. simple LONG persists LONG (21. survives readback via the read model)', () => {
  const { db, svc, trading } = fresh()
  const r = svc.import(norm(LONG), OPTS)
  equal(counts(r), [1, 0, 0, 0])
  equal(tradeBy(db, '100').direction, 'LONG')
  equal(trading.list().trades[0]?.direction, 'Long')
  db.close()
})
check('2. simple SHORT persists SHORT (21. survives readback via the read model)', () => {
  const { db, svc, trading } = fresh()
  svc.import(norm(SHORT), OPTS)
  equal(tradeBy(db, '110').direction, 'SHORT')
  equal(trading.list().trades[0]?.direction, 'Short')
  db.close()
})
check('3. scale-in/out persists ONE Trade with FOUR Executions in order', () => {
  const { db, svc, trading } = fresh()
  const r = svc.import(norm(SCALE), OPTS)
  equal([r.created.length, r.created[0]?.executionCount], [1, 4])
  const t = tradeBy(db, '120')
  const ex = db.repositories.trades.listExecutions(t.id)
  equal(ex.map((e) => e.side), ['BUY', 'BUY', 'SELL', 'SELL'])
  equal([t.quantity, t.avgEntryPrice, t.avgExitPrice], ['2', '1.0851', '1.0861'])
  equal(trading.getDetail(t.id).executions.length, 4)
  db.close()
})

// ---- 4, 11-13 skips -------------------------------------------------------------
check('4. partial/open lifecycle is skipped and reported, not persisted', () => {
  const { db, svc } = fresh()
  const r = svc.import(norm([...LONG, ...OPEN_PARTIAL]), OPTS)
  equal([r.created.length, r.skippedOpen.length, r.skippedOpen[0]?.sourcePositionId], [1, 1, '130'])
  equal(rowCount(db, 'trades'), 1)
  db.close()
})
check('11. BALANCE / non-trading facts create no Trade (and no Account when nothing importable)', () => {
  const { db, svc } = fresh()
  const r = svc.import(norm([{ t: '70', pos: '0', type: BALANCE, entry: IN, profit: '1000' }]), OPTS)
  equal([r.ignoredNonTrading, r.created.length, r.account.action], [1, 0, 'not-needed'])
  equal([rowCount(db, 'trades'), rowCount(db, 'accounts')], [0, 0])
  db.close()
})
check('12. unresolved INOUT creates no Trade (reported as unsupported)', () => {
  const { db, svc } = fresh()
  const r = svc.import(
    norm([
      { t: '80', pos: '180', type: BUY, entry: IN },
      { t: '81', pos: '180', type: SELL, entry: INOUT, vol: '2' }
    ]),
    OPTS
  )
  equal([r.created.length, r.skippedUnsupported.length], [0, 1])
  equal(rowCount(db, 'trades'), 0)
  db.close()
})
check('13. OUT_BY unsupported creates no Trade', () => {
  const { db, svc } = fresh()
  const r = svc.import(
    norm([
      { t: '90', pos: '190', type: BUY, entry: IN },
      { t: '91', pos: '191', type: SELL, entry: IN },
      { t: '92', pos: '190', type: SELL, entry: OUT_BY },
      { t: '93', pos: '191', type: BUY, entry: OUT_BY }
    ]),
    OPTS
  )
  equal([r.created.length, r.skippedUnsupported.length], [0, 2])
  equal(rowCount(db, 'trades'), 0)
  db.close()
})
check('unresolved (non-unsupported) lifecycle is reported separately and never persisted', () => {
  const { db, svc } = fresh()
  const r = svc.import(norm([{ t: '95', pos: '195', type: SELL, entry: OUT }]), OPTS)
  equal([r.skippedUnresolved.length, r.skippedUnsupported.length, r.created.length], [1, 0, 0])
  equal(rowCount(db, 'trades'), 0)
  db.close()
})

// ---- 5-6 independence -------------------------------------------------------------
check('5. two hedged same-symbol positions become two independent Trades', () => {
  const { db, svc } = fresh()
  svc.import(norm(HEDGED), OPTS)
  equal([tradeBy(db, '140').direction, tradeBy(db, '141').direction], ['LONG', 'SHORT'])
  equal(rowCount(db, 'trades'), 2)
  db.close()
})
check('6. different symbols remain independent Trades', () => {
  const { db, svc } = fresh()
  svc.import(norm(OTHER_SYMBOLS), OPTS)
  equal([tradeBy(db, '150').instrument, tradeBy(db, '151').instrument], ['EURUSD', 'GBPJPY'])
  db.close()
})

// ---- 7-9, 19, 24 idempotency --------------------------------------------------------
check('7/9/19/24. identical replay: 0 new Trades, 0 new Executions, same Account, history untouched', () => {
  const { db, svc } = fresh()
  const input = norm([...LONG, ...SHORT, ...SCALE, ...HEDGED])
  const first = svc.import(input, OPTS)
  equal(counts(first), [5, 0, 0, 0])
  const snapshot = JSON.stringify(db.repositories.trades.list().map((t) => [t, db.repositories.trades.listExecutions(t.id)]))
  const accountId = first.account.accountId
  const second = svc.import(norm([...LONG, ...SHORT, ...SCALE, ...HEDGED]), OPTS)
  equal(counts(second), [0, 5, 0, 0])
  equal([second.account.action, second.account.accountId], ['reused', accountId])
  equal([rowCount(db, 'trades'), rowCount(db, 'executions'), rowCount(db, 'accounts')], [5, 12, 1])
  equal(JSON.stringify(db.repositories.trades.list().map((t) => [t, db.repositories.trades.listExecutions(t.id)])), snapshot)
  db.close()
})
check('8. old + one new lifecycle creates exactly one new Trade; old unchanged', () => {
  const { db, svc } = fresh()
  svc.import(norm([...LONG, ...SHORT]), OPTS)
  const before = JSON.stringify(db.repositories.trades.list())
  const r = svc.import(norm([...LONG, ...SHORT, ...NEW_ONE]), OPTS)
  equal(counts(r), [1, 2, 0, 0])
  equal(rowCount(db, 'trades'), 3)
  equal(JSON.stringify(db.repositories.trades.list().filter((t) => t.sourcePositionId !== '160')), before)
  db.close()
})
check('replay is independent of input deal order', () => {
  const { db, svc } = fresh()
  const list = [...LONG, ...SCALE, ...SHORT]
  svc.import(norm(list), OPTS)
  const r = svc.import(norm([...list].reverse()), OPTS)
  equal(counts(r), [0, 3, 0, 0])
  db.close()
})

// ---- 10 conflict ----------------------------------------------------------------------
check('10. same source lifecycle with different facts is a CONFLICT and never overwrites', () => {
  const { db, svc } = fresh()
  svc.import(norm(LONG), OPTS)
  const before = JSON.stringify([db.repositories.trades.list(), rowCount(db, 'executions')])
  const changed = LONG.map((d) => (d.t === '2' ? { ...d, price: '1.09000', profit: '999' } : d))
  const r = svc.import(norm(changed), OPTS)
  equal(counts(r), [0, 0, 1, 0])
  assert(
    r.conflicts[0]!.differences.includes('grossPnl') && r.conflicts[0]!.differences.includes('execution.price'),
    'names the differing facts'
  )
  equal(JSON.stringify([db.repositories.trades.list(), rowCount(db, 'executions')]), before)
  db.close()
})
check('an execution already owned by a different Trade is a conflict, not a duplicate', () => {
  const { db, svc } = fresh()
  svc.import(norm(LONG), OPTS)
  // Same deals re-associated to another position id: different lifecycle key, same deal identities.
  const moved = LONG.map((d) => ({ ...d, pos: '999' }))
  const r = svc.import(norm(moved), OPTS)
  equal(counts(r), [0, 0, 1, 0])
  equal(r.conflicts[0]?.differences, ['executionOwnedByAnotherTrade'])
  equal([rowCount(db, 'trades'), rowCount(db, 'executions')], [1, 2])
  db.close()
})

// ---- 14-15 costs -----------------------------------------------------------------------
check('14. costs round-trip exactly; gross/commission/fees/swap/net stay separate', () => {
  const { db, svc } = fresh()
  svc.import(
    norm([
      { t: '201', pos: '200', type: BUY, entry: IN, price: '1.08501', commission: '-3.55', fee: '-0.25' },
      { t: '202', pos: '200', type: SELL, entry: OUT, price: '1.08652', profit: '150.10', commission: '-3.5', swap: '-1.10' }
    ]),
    OPTS
  )
  const t = tradeBy(db, '200')
  equal([t.grossPnl, t.commission, t.fees, t.swap, t.netPnl], ['150.1', '-7.05', '-0.25', '-1.1', '141.7'])
  const ex = db.repositories.trades.listExecutions(t.id)
  equal(ex.map((e) => [e.commission, e.fees, e.swap]), [['-3.55', '-0.25', null], ['-3.5', null, '-1.1']])
  db.close()
})
check('15. NULL costs stay NULL and a reported zero stays zero (trade + execution level)', () => {
  const { db, svc } = fresh()
  svc.import(norm(SHORT), OPTS)
  const a = tradeBy(db, '110')
  equal([a.commission, a.fees, a.swap], [null, null, null])
  equal(a.netPnl, '100')
  const { db: db2, svc: svc2 } = fresh()
  svc2.import(
    norm([
      { t: '211', pos: '210', type: BUY, entry: IN, commission: '0', swap: '0' },
      { t: '212', pos: '210', type: SELL, entry: OUT, profit: '5', commission: '0', swap: '0' }
    ]),
    OPTS
  )
  const b = tradeBy(db2, '210')
  equal([b.commission, b.fees, b.swap], ['0', null, '0'])
  db.close()
  db2.close()
})
check('net P&L is null when no deal reported profit (never an invented zero)', () => {
  const { db, svc } = fresh()
  svc.import(
    norm([
      { t: '221', pos: '220', type: BUY, entry: IN },
      { t: '222', pos: '220', type: SELL, entry: OUT }
    ]),
    OPTS
  )
  equal([tradeBy(db, '220').grossPnl, tradeBy(db, '220').netPnl], [null, null])
  db.close()
})

// ---- 16-18 defaults -----------------------------------------------------------------------
check('16-18. Strategy stays null; no Rule Evaluations, no Trade/Day Notes are fabricated', () => {
  const { db, svc, trading } = fresh()
  svc.import(norm([...LONG, ...SCALE]), OPTS)
  for (const t of db.repositories.trades.list()) {
    equal(t.strategyVersionId, null)
    equal(db.repositories.evaluations.listForTrade(t.id).length, 0)
    equal(db.repositories.notes.getTradeNote(t.id), null)
    equal(db.repositories.notes.getDayNote(t.accountId, t.analyticalTradeDate), null)
    const d = trading.getDetail(t.id)
    equal([d.strategy, d.tradeNote, d.dayNote], [null, '', ''])
    equal([t.plannedR, t.realizedR], [null, null])
  }
  db.close()
})

// ---- 19-20 account/symbol ---------------------------------------------------------------------
check('19. account is created once, keyed by platform + server + login, masked display name', () => {
  const { db, svc } = fresh()
  const r1 = svc.import(norm(LONG), OPTS)
  const r2 = svc.import(norm(SHORT), OPTS)
  equal([r1.account.action, r2.account.action], ['created', 'reused'])
  const acc = db.repositories.accounts.list()[0]!
  equal(
    [acc.sourcePlatform, acc.sourceAccountId, acc.displayName, acc.timezone],
    [MT5_PLATFORM, mt5SourceAccountId('Demo-Server', '1000002'), 'MT5 · ***002', null]
  )
  equal(rowCount(db, 'accounts'), 1)
  assert(!acc.displayName.includes('1000002') && !JSON.stringify(r1).includes('1000002'), 'full login not in display name or result')
  equal(maskLogin('12345'), '***')
  db.close()
})
check('a different login on the same server is a different Account', () => {
  const { db, svc } = fresh()
  svc.import(norm(LONG), OPTS)
  const other: Mt5AccountContext = { ...ACCOUNT, accountLogin: '2000009' }
  const raw = LONG.map((d) => ({ ...deal(d), accountLogin: '2000009' }))
  svc.import(normalizeMt5Deals(raw, other), OPTS)
  equal(rowCount(db, 'accounts'), 2)
  equal(rowCount(db, 'trades'), 2)
  db.close()
})
check('20. source symbol suffix is preserved exactly', () => {
  const { db, svc } = fresh()
  svc.import(norm(SHORT), OPTS)
  equal(tradeBy(db, '110').instrument, 'XAUUSD.x')
  db.close()
})

// ---- 22 analytical date --------------------------------------------------------------------------
check('22. analytical date: UTC calendar date of the opening deal as reported; deterministic across midnight', () => {
  equal(mt5AnalyticalDate(Date.UTC(2026, 0, 5, 23, 59, 59, 999)), '2026-01-05')
  equal(mt5AnalyticalDate(Date.UTC(2026, 0, 6, 0, 0, 0, 0)), '2026-01-06')
  const { db, svc } = fresh()
  svc.import(
    norm([
      { t: '231', pos: '230', at: Date.UTC(2026, 0, 5, 23, 59, 59, 999), type: BUY, entry: IN },
      { t: '232', pos: '230', at: Date.UTC(2026, 0, 6, 0, 30, 0, 0), type: SELL, entry: OUT, profit: '1' }
    ]),
    OPTS
  )
  const t = tradeBy(db, '230')
  equal(
    [t.analyticalTradeDate, t.openedAt, t.closedAt],
    ['2026-01-05', Date.UTC(2026, 0, 5, 23, 59, 59, 999), Date.UTC(2026, 0, 6, 0, 30, 0, 0)]
  )
  db.close()
})

// ---- 23 rollback -------------------------------------------------------------------------------------
check('23. a failing lifecycle rolls back completely (no half-Trade) and does not affect siblings or history', () => {
  const { db, svc } = fresh()
  svc.import(norm(LONG), OPTS)
  const good = norm(SHORT)
  const victim = norm(SCALE).completed[0]!
  // Two executions with the same source identity: the second INSERT violates the unique index
  // AFTER the Trade row and first execution were written, so only a rollback keeps this clean.
  const broken: CompletedTradeCandidate = {
    ...victim,
    executions: victim.executions.map((e, i) => (i === 1 ? { ...e, sourceExecutionKey: victim.executions[0]!.sourceExecutionKey } : e))
  }
  const tradesBefore = rowCount(db, 'trades')
  const execsBefore = rowCount(db, 'executions')
  const r = svc.import({ ...good, completed: [...good.completed, broken] }, OPTS)
  equal([r.created.length, r.failed.length, r.failed[0]?.reason], [1, 1, 'WRITE_FAILED'])
  equal(rowCount(db, 'trades'), tradesBefore + 1)
  equal(rowCount(db, 'executions'), execsBefore + 2)
  equal(db.repositories.trades.list().some((t) => t.sourcePositionId === '120'), false)
  db.close()
})
check('an incoherent candidate is rejected before any write', () => {
  const { db, svc } = fresh()
  svc.import(norm(LONG), OPTS)
  const c = norm(SHORT).completed[0]!
  const bad: CompletedTradeCandidate = { ...c, netPnl: '12345' }
  const r = svc.import({ ...norm(SHORT), completed: [bad] }, OPTS)
  equal([r.failed[0]?.reason, r.created.length, rowCount(db, 'trades')], ['INCOHERENT_CANDIDATE', 0, 1])
  db.close()
})

// ---- dry run ---------------------------------------------------------------------------------------------
check('dry run reports the plan and performs NO writes (not even the Account); real run then matches', () => {
  const { db, svc } = fresh()
  const input = norm([...LONG, ...SCALE, ...OPEN_PARTIAL])
  const dry = svc.import(input, { ...OPTS, dryRun: true })
  equal(
    [dry.dryRun, dry.account.action, dry.created.length, dry.totals.executionsCreated, dry.skippedOpen.length],
    [true, 'would-create', 2, 6, 1]
  )
  equal([rowCount(db, 'accounts'), rowCount(db, 'trades')], [0, 0])
  const real = svc.import(input, OPTS)
  equal([real.created.length, real.totals.executionsCreated], [dry.created.length, dry.totals.executionsCreated])
  const dry2 = svc.import(input, { ...OPTS, dryRun: true })
  equal([dry2.created.length, dry2.alreadyExisting.length, dry2.account.action], [0, 2, 'reused'])
  db.close()
})

// ---- end to end ------------------------------------------------------------------------------------------------
check('E2E: synthetic raw deals -> normalizer -> import -> SQLite -> TradingService; exact facts; replay adds nothing', () => {
  const { db, svc, trading } = fresh()
  const all: D[] = [{ t: '300', pos: '0', type: BALANCE, entry: IN, profit: '50000' }, ...LONG, ...SHORT, ...SCALE, ...OPEN_PARTIAL]
  const r = svc.import(norm(all), OPTS)
  equal(counts(r), [3, 0, 0, 0])
  const list = trading.list()
  equal(list.accounts.length, 1)
  equal(list.trades.length, 3)
  const long = list.trades.find((t) => t.instrument === 'EURUSD' && t.quantity === '1')!
  equal(
    [long.direction, long.tradeDate, long.avgEntry, long.avgExit, long.grossPnl, long.commission, long.fees, long.swap, long.netPnl, long.strategy],
    ['Long', '2026-01-05', '1.085', '1.0865', '150', '-7', null, null, '143', null]
  )
  const detail = trading.getDetail(long.id)
  equal(
    detail.executions.map((e) => [e.side, e.quantity, e.price, e.commission]),
    [['BUY', '1', '1.085', '-3.5'], ['SELL', '1', '1.0865', '-3.5']]
  )
  const src = db.repositories.trades.listExecutions(long.id).map((e) => e.sourceExecutionId)
  assert(src.every((s) => typeof s === 'string' && s.startsWith('["MT5"')), 'executions carry deal provenance')
  const again = svc.import(norm(all), OPTS)
  equal(counts(again), [0, 3, 0, 0])
  equal([rowCount(db, 'trades'), rowCount(db, 'executions'), rowCount(db, 'accounts')], [3, 8, 1])
  db.close()
})

// ---- guards --------------------------------------------------------------------------------------------------------
check('coexistence: an existing demo/other-platform Account is never reused or touched', () => {
  const { db, svc } = fresh()
  const demo = db.repositories.accounts.create({ displayName: 'Demo', sourcePlatform: 'dev-fixture', sourceAccountId: 'x', currency: 'USD' })
  const r = svc.import(norm(LONG), OPTS)
  assert(r.account.accountId !== demo.id, 'separate account')
  equal(db.repositories.trades.list({ accountId: demo.id }).length, 0)
  equal(db.repositories.trades.list({ accountId: r.account.accountId! }).length, 1)
  db.close()
})
check('static: import module has no order/execution capability, no methodology terms; startup never imports', () => {
  const dir = resolve(process.cwd(), 'src/main/integrations/mt5/import')
  const forbidden = /OrderSend|CTrade|OrderCancel|PositionClose|PositionModify|net\.connect|createConnection|\bfetch\(|from 'electron'|ipcMain/
  const methodology = /\b(ICT|CRT|SMT|VWAP|FVG|liquidity|sweep|opening range|bias)\b/i
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    assert(!forbidden.test(src), `${file} matches a forbidden capability`)
    assert(!methodology.test(src), `${file} mentions a methodology concept`)
  }
  const main = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8')
  assert(!/Mt5ImportService|mt5ImportService|importFromLiveStaging|liveImport'/.test(main), 'src/main/index.ts must not reference the import service or the live import directly')
  assert(/startDevImportGateFromEnvironment\(process\.env, !app\.isPackaged/.test(main), 'the gate starts only via the env/unpackaged guard')
})

// ===========================================================================
// Live-staging import gate (final 012B-2 gate)
// ===========================================================================
const REAL_LOGIN = '7654321'
const REAL_SERVER = 'RealBroker-Live01'

function liveSource(
  list: D[],
  o: { currency?: string; sync?: 'complete' | 'in_progress' | null; connected?: boolean; login?: string; extraAccount?: boolean } = {}
): LiveStagingSource {
  const login = o.login ?? REAL_LOGIN
  const acct = (l: string): Mt5AccountStatus =>
    ({
      server: REAL_SERVER,
      login: l,
      company: null,
      currency: o.currency ?? 'EUR',
      marginMode: 2,
      positionAccounting: 'RETAIL_HEDGING',
      tradeMode: 0,
      hedgeCapable: true,
      eaVersion: 't',
      terminalBuild: 1,
      connected: o.connected ?? true,
      lastHelloAt: 1,
      lastHeartbeatAt: null,
      lastSync:
        o.sync === null
          ? null
          : { syncId: 's', status: o.sync ?? 'complete', discovered: 1, sent: 1, failed: 0, received: 1, accepted: 1, duplicates: 0 },
      dealsAccepted: list.length,
      duplicatesIgnored: 0,
      unresolvedDealTickets: []
    }) as unknown as Mt5AccountStatus
  const deals = list.map((d) => ({ ...deal(d), server: REAL_SERVER, accountLogin: login }))
  return {
    getStatus: () =>
      ({ accounts: o.extraAccount === true ? [acct(login), acct('9999999')] : [acct(login)], stagedDeals: deals.length }) as unknown as Mt5ReceiverStatus,
    getStagedDeals: () =>
      deals.map((d, i) => ({ identity: String(i), deal: d, arrivalSeq: i, origin: 'history', syncId: 's' }) as StagedDeal)
  }
}
const LIVE_BOOK: D[] = [...LONG, ...SHORT, ...SCALE, ...OPEN_PARTIAL]
const totalRows = (db: Database): string => `${rowCount(db, 'accounts')}/${rowCount(db, 'trades')}/${rowCount(db, 'executions')}`

check('live: first explicit import uses the LIVE hello identity (not a pseudonym) and hello currency', () => {
  const { db } = fresh()
  const out = importFromLiveStaging(liveSource(LIVE_BOOK), db)
  assert(out.ok, 'import succeeds')
  equal([out.summary.result.created.length, out.summary.result.totals.executionsCreated, out.summary.result.skippedOpen.length], [3, 8, 1])
  const acc = db.repositories.accounts.list()[0]!
  equal([acc.sourcePlatform, acc.sourceAccountId, acc.currency], [MT5_PLATFORM, mt5SourceAccountId(REAL_SERVER, REAL_LOGIN), 'EUR'])
  assert(!isPseudonymizedSnapshotAccount({ server: REAL_SERVER }), 'live server is not a pseudonym')
  equal([out.summary.before.trades, out.summary.after.trades, out.summary.after.executions], [0, 3, 8])
  db.close()
})
check('live: second explicit import creates 0 Trades / 0 Executions, all already existing, same Account', () => {
  const { db } = fresh()
  const src = liveSource(LIVE_BOOK)
  const first = importFromLiveStaging(src, db)
  assert(first.ok, 'first ok')
  const rows = totalRows(db)
  const second = importFromLiveStaging(src, db)
  assert(second.ok, 'second ok')
  equal(
    [second.summary.result.created.length, second.summary.result.alreadyExisting.length, second.summary.result.totals.executionsCreated],
    [0, 3, 0]
  )
  equal([second.summary.account.action, second.summary.result.account.accountId], ['reused', first.summary.result.account.accountId])
  equal(totalRows(db), rows)
  equal([second.summary.before.trades, second.summary.after.trades], [3, 3])
  db.close()
})
check('live: missing/invalid hello currency refuses the import and writes nothing', () => {
  for (const currency of ['', 'usd', 'US', 'USDX', 'U$D']) {
    const { db } = fresh()
    const out = importFromLiveStaging(liveSource(LIVE_BOOK, { currency }), db)
    assert(!out.ok && out.reason === 'CURRENCY_INVALID', `currency ${JSON.stringify(currency)} refused`)
    equal(totalRows(db), '0/0/0')
    db.close()
  }
})
check('live: incomplete history sync, disconnected account, no accounts and ambiguity are all refused', () => {
  const { db } = fresh()
  const reason = (s: LiveStagingSource, opts?: { accountMask?: string }): string => {
    const o = importFromLiveStaging(s, db, opts)
    return o.ok ? 'OK' : o.reason
  }
  equal(reason(liveSource(LIVE_BOOK, { sync: 'in_progress' })), 'HISTORY_SYNC_NOT_COMPLETE')
  equal(reason(liveSource(LIVE_BOOK, { sync: null })), 'HISTORY_SYNC_NOT_COMPLETE')
  equal(reason(liveSource(LIVE_BOOK, { connected: false })), 'ACCOUNT_NOT_CONNECTED')
  equal(reason(liveSource(LIVE_BOOK, { extraAccount: true })), 'ACCOUNT_AMBIGUOUS')
  equal(reason(liveSource(LIVE_BOOK, { extraAccount: true }), { accountMask: '***321' }), 'OK')
  equal(reason(liveSource(LIVE_BOOK), { accountMask: '***000' }), 'ACCOUNT_NOT_FOUND')
  equal(reason({ getStatus: () => ({ accounts: [] }) as unknown as Mt5ReceiverStatus, getStagedDeals: () => [] }), 'NO_MT5_ACCOUNT')
  db.close()
})
check('live: real source identity never appears in the summary, lines, refusals or report (masked only)', () => {
  const { db } = fresh()
  const out = importFromLiveStaging(liveSource(LIVE_BOOK), db)
  assert(out.ok, 'ok')
  const text = JSON.stringify(out.summary.lines) + JSON.stringify(out.summary.account)
  assert(!text.includes(REAL_LOGIN) && !text.includes(REAL_SERVER), 'no unmasked identity in summary')
  assert(text.includes('***321'), 'masked identity present')
  const refused = importFromLiveStaging(liveSource(LIVE_BOOK, { currency: 'x' }), db)
  assert(!refused.ok && !refused.message.includes(REAL_LOGIN) && !refused.message.includes(REAL_SERVER), 'refusal masked')
  const report = buildPersistedReport(db).join('\n')
  assert(!report.includes(REAL_LOGIN) && !report.includes(REAL_SERVER), 'report masked')
  db.close()
})
check('live: explicit action cannot target a production-named database (dev profile / temp / memory only)', () => {
  const prod = join(homedir(), 'AppData', 'Roaming', 'solid-skill', 'solid-skill.db')
  const dev = join(homedir(), 'AppData', 'Roaming', 'solid-skill-dev', 'solid-skill.db')
  equal([isDevelopmentDatabasePath(prod), isDevelopmentDatabasePath(dev), isDevelopmentDatabasePath(':memory:')], [false, true, true])
  const { db } = fresh()
  const fakeProd = Object.create(db, { health: { value: { ...db.health, path: prod } } }) as Database
  const out = importFromLiveStaging(liveSource(LIVE_BOOK), fakeProd)
  assert(!out.ok && out.reason === 'NOT_DEVELOPMENT_DATABASE', 'production path refused')
  equal(totalRows(db), '0/0/0')
  db.close()
})

check('gate: normal startup performs ZERO imports (disabled unless unpackaged + SOLID_SKILL_MT5_DEV_IMPORT=1)', () => {
  const base = mkdtempSync(join(tmpdir(), 'ss-gate-'))
  try {
    const { db } = fresh()
    const deps = { baseDir: base, getReceiver: () => liveSource(LIVE_BOOK), getDatabase: () => db, log: () => undefined }
    equal(startDevImportGateFromEnvironment({}, true, deps), null)
    equal(startDevImportGateFromEnvironment({ SOLID_SKILL_MT5_DEV_IMPORT: '1' }, false, deps), null)
    equal(startDevImportGateFromEnvironment({ SOLID_SKILL_MT5_DEV_IMPORT: '0' }, true, deps), null)
    const dir = devSnapshotDirectory(base)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, LIVE_IMPORT_REQUEST_FILE),
      JSON.stringify({ action: LIVE_IMPORT_ACTION, confirm: LIVE_IMPORT_CONFIRMATION, requestId: 'a', createdAt: Date.now() })
    )
    equal(totalRows(db), '0/0/0')
    assert(existsSync(join(dir, LIVE_IMPORT_REQUEST_FILE)), 'request untouched while gate is off')
    rmSync(join(dir, LIVE_IMPORT_REQUEST_FILE))
    const gate = startDevImportGateFromEnvironment({ SOLID_SKILL_MT5_DEV_IMPORT: '1' }, true, deps)
    assert(gate !== null, 'gate starts when explicitly enabled')
    gate.pollOnce()
    equal(totalRows(db), '0/0/0')
    gate.stop()
    db.close()
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
check('gate: fresh confirmed request imports once; the file cannot fire twice; replay creates nothing', () => {
  const base = mkdtempSync(join(tmpdir(), 'ss-gate-'))
  try {
    const { db } = fresh()
    const logs: string[] = []
    const gate = startDevImportGate({ baseDir: base, getReceiver: () => liveSource(LIVE_BOOK), getDatabase: () => db, log: (m) => logs.push(m) })
    const dir = devSnapshotDirectory(base)
    mkdirSync(dir, { recursive: true })
    const request = (id: string): void =>
      writeFileSync(
        join(dir, LIVE_IMPORT_REQUEST_FILE),
        JSON.stringify({ action: LIVE_IMPORT_ACTION, confirm: LIVE_IMPORT_CONFIRMATION, requestId: id, createdAt: Date.now() })
      )
    const result = (): { ok: boolean; requestId: string | null; lines?: string[] } =>
      JSON.parse(readFileSync(join(dir, LIVE_IMPORT_RESULT_FILE), 'utf8'))
    request('req-1')
    gate.pollOnce()
    equal(totalRows(db), '1/3/8')
    assert(!existsSync(join(dir, LIVE_IMPORT_REQUEST_FILE)), 'request consumed')
    equal([result().ok, result().requestId], [true, 'req-1'])
    gate.pollOnce()
    equal(totalRows(db), '1/3/8')
    request('req-2')
    gate.pollOnce()
    equal(totalRows(db), '1/3/8')
    assert(
      result().lines!.some((l) => l.includes('created Trades: 0; already-existing Trades: 3; created Executions: 0')),
      'replay summary'
    )
    const everything = logs.join('\n') + JSON.stringify(result())
    assert(!everything.includes(REAL_LOGIN) && !everything.includes(REAL_SERVER), 'gate logs/result are masked')
    gate.stop()
    db.close()
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
check('gate: stale, unconfirmed, malformed or unknown-action requests are discarded WITHOUT importing', () => {
  const base = mkdtempSync(join(tmpdir(), 'ss-gate-'))
  try {
    const { db } = fresh()
    const gate = startDevImportGate({ baseDir: base, getReceiver: () => liveSource(LIVE_BOOK), getDatabase: () => db, log: () => undefined })
    const dir = devSnapshotDirectory(base)
    mkdirSync(dir, { recursive: true })
    const good = { action: LIVE_IMPORT_ACTION, confirm: LIVE_IMPORT_CONFIRMATION, requestId: 'x', createdAt: Date.now() }
    const bads: unknown[] = [
      { ...good, createdAt: Date.now() - 10 * 60_000 },
      { ...good, confirm: 'yes' },
      { ...good, action: 'drop-table' },
      { ...good, requestId: '../evil' },
      { ...good, account: '514' },
      'not json'
    ]
    for (const bad of bads) {
      writeFileSync(join(dir, LIVE_IMPORT_REQUEST_FILE), typeof bad === 'string' ? bad : JSON.stringify(bad))
      gate.pollOnce()
      assert(!existsSync(join(dir, LIVE_IMPORT_REQUEST_FILE)), 'consumed')
      equal(totalRows(db), '0/0/0')
    }
    gate.stop()
    db.close()
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
check('snapshot: pseudonymized snapshots are recognised (dry-run only) and the dry run still writes nothing', () => {
  const raw = LIVE_BOOK.map((d) => ({ ...deal(d), server: REAL_SERVER, accountLogin: REAL_LOGIN }))
  const snap = buildDevSnapshot({ server: REAL_SERVER, login: REAL_LOGIN, accounting: 'RETAIL_HEDGING' }, raw, 'now')
  assert(isPseudonymizedSnapshotAccount(snap.account), 'pseudonymized account detected')
  assert(!isPseudonymizedSnapshotAccount({ server: 'Demo-Server' }), 'ordinary server is not flagged')
  assert(!JSON.stringify(snap).includes(REAL_LOGIN) && !JSON.stringify(snap).includes(REAL_SERVER), 'snapshot keeps identity pseudonymous')
  const { db, svc } = fresh()
  const dry = svc.import(normalizeMt5Deals(snap.deals, snap.account), { currency: 'XXX', dryRun: true })
  equal([dry.dryRun, dry.created.length, dry.account.action], [true, 3, 'would-create'])
  equal(totalRows(db), '0/0/0')
  db.close()
})

for (const line of lines) console.log(line)
console.log(`\nmt5-import smoke: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
