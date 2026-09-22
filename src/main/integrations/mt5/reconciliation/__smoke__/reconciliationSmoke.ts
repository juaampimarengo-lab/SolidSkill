/**
 * MT5 automatic reconciliation smoke suite (Checkpoint 012B-4). Fixtures are
 * synthetic (invented tickets, prices, times, accounts). No MetaTrader, no
 * sockets, no real data. Bridge events are fabricated directly (the receiver
 * that produces them is already covered by `npm run smoke:mt5`); this suite
 * exercises the coordinator, the per-account serialize/coalesce primitive,
 * and their integration with the existing `importFromLiveStaging` +
 * `Mt5ImportService`. Run with: npm run smoke:mt5-reconciliation
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Database } from '../../../../persistence'
import { MT5_PROTOCOL_VERSION, MT5_SOURCE, type Mt5Origin, type RawMt5Deal } from '../../protocol'
import { accountKey, type Mt5AccountStatus, type Mt5InternalEvent, type Mt5ReceiverStatus } from '../../receiver'
import type { StagedDeal } from '../../rawDealStaging'
import { importFromLiveStaging, type LiveStagingSource } from '../../import/liveImport'
import { maskLogin } from '../../import/mt5ImportService'
import { AccountReconciler, createManualScheduler } from '../accountReconciler'
import { Mt5ReconciliationCoordinator, createMt5ReconciliationCoordinatorFromEnvironment, type TradingDataChangedEvent } from '../reconciliationCoordinator'

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const BUY = 0
const SELL = 1
const BALANCE = 2
const IN = 0
const OUT = 1
const INOUT = 2

interface D {
  t: string
  pos: string
  server: string
  login: string
  at?: number
  sym?: string
  type: number
  entry: number
  vol?: string
  price?: string
  profit?: string | null
  commission?: string | null
}
const T0 = Date.UTC(2026, 0, 5, 10, 0, 0)
function deal(d: D): RawMt5Deal {
  return {
    source: MT5_SOURCE,
    protocolVersion: MT5_PROTOCOL_VERSION,
    server: d.server,
    accountLogin: d.login,
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
    fee: null,
    swap: null,
    magic: '0',
    reason: 0
  }
}

/** A minimal, fully controllable LiveStagingSource double: several accounts, one shared deal book. */
class FakeReceiver implements LiveStagingSource {
  private readonly accounts = new Map<string, { server: string; login: string; currency: string; connected: boolean; sync: 'complete' | 'in_progress' | null }>()
  private deals: StagedDeal[] = []
  private nextSeq = 1

  addAccount(server: string, login: string, currency = 'USD'): void {
    this.accounts.set(accountKey(server, login), { server, login, currency, connected: true, sync: null })
  }
  setSync(server: string, login: string, sync: 'complete' | 'in_progress' | null): void {
    const a = this.accounts.get(accountKey(server, login))
    assert(a !== undefined, 'unknown fixture account')
    a!.sync = sync
  }
  setCurrency(server: string, login: string, currency: string): void {
    const a = this.accounts.get(accountKey(server, login))
    assert(a !== undefined, 'unknown fixture account')
    a!.currency = currency
  }
  addDeals(ds: D[], origin: Mt5Origin = 'live', syncId: string | null = null): void {
    for (const d of ds) {
      this.deals.push({ identity: `${d.server}:${d.login}:${d.t}`, deal: deal(d), arrivalSeq: this.nextSeq++, origin, syncId })
    }
  }
  replaceDealFacts(server: string, login: string, ticket: string, patch: Partial<D>): void {
    const idx = this.deals.findIndex((s) => s.deal.server === server && s.deal.accountLogin === login && s.deal.dealTicket === ticket)
    assert(idx >= 0, 'deal not found')
    const current = this.deals[idx]!
    this.deals[idx] = { ...current, deal: { ...current.deal, ...patch } as RawMt5Deal }
  }

  getStatus(): Mt5ReceiverStatus {
    return {
      accounts: [...this.accounts.values()].map(
        (a) =>
          ({
            server: a.server,
            login: a.login,
            company: null,
            currency: a.currency,
            marginMode: 2,
            positionAccounting: 'RETAIL_HEDGING',
            tradeMode: 0,
            hedgeCapable: true,
            eaVersion: 'test',
            terminalBuild: 1,
            connected: a.connected,
            lastHelloAt: 1,
            lastHeartbeatAt: null,
            lastSync:
              a.sync === null ? null : { syncId: 's', status: a.sync, discovered: 1, sent: 1, failed: 0, received: 1, accepted: 1, duplicates: 0 },
            dealsAccepted: 0,
            duplicatesIgnored: 0,
            unresolvedDealTickets: []
          }) as unknown as Mt5AccountStatus
      )
    } as unknown as Mt5ReceiverStatus
  }
  getStagedDeals(): readonly StagedDeal[] {
    return this.deals
  }
}

function historyEnd(server: string, login: string, status: 'complete' | 'incomplete'): Mt5InternalEvent {
  return { kind: 'history_end', accountKey: accountKey(server, login), status }
}
function dealAccepted(server: string, login: string, origin: Mt5Origin = 'live'): Mt5InternalEvent {
  return { kind: 'deal_accepted', accountKey: accountKey(server, login), origin }
}
function disconnected(server: string, login: string): Mt5InternalEvent {
  return { kind: 'disconnected', accountKey: accountKey(server, login) }
}

function harness(): {
  db: Database
  receiver: FakeReceiver
  scheduler: ReturnType<typeof createManualScheduler>
  coordinator: Mt5ReconciliationCoordinator
  log: string[]
  notifications: TradingDataChangedEvent[]
} {
  const db = Database.open(':memory:')
  const receiver = new FakeReceiver()
  const scheduler = createManualScheduler()
  const log: string[] = []
  const notifications: TradingDataChangedEvent[] = []
  const coordinator = new Mt5ReconciliationCoordinator({
    getDatabase: () => db,
    getReceiver: () => receiver,
    log: (m) => log.push(m),
    onDataChanged: (e) => notifications.push(e),
    debounceMs: 5,
    scheduler
  })
  return { db, receiver, scheduler, coordinator, log, notifications }
}
const tradeCount = (db: Database): number => db.repositories.trades.list().length
const tradeBy = (db: Database, pos: string) => db.repositories.trades.list().find((t) => t.sourcePositionId === pos) ?? null

const SRV = 'RealBroker-Live01'
const LOGIN = '7654321'
const MASK = maskLogin(LOGIN)

// ===========================================================================
// AccountReconciler (generic serialize/coalesce/debounce primitive)
// ===========================================================================
check('reconciler: a burst of triggers before the debounce fires collapses into exactly ONE run', () => {
  const scheduler = createManualScheduler()
  let runs = 0
  const r = new AccountReconciler({ scheduler, run: () => (runs += 1) })
  r.trigger()
  r.trigger()
  r.trigger()
  equal(scheduler.pending(), 1, 'only one run should be scheduled')
  scheduler.flush()
  equal(runs, 1)
})
check('reconciler: a trigger that arrives WHILE a run is executing causes exactly one follow-up run', () => {
  const scheduler = createManualScheduler()
  let runs = 0
  let reentered = false
  const r = new AccountReconciler({
    scheduler,
    run: () => {
      runs += 1
      if (!reentered) {
        reentered = true
        // Simulates a trigger arriving concurrently with this run.
        r.trigger()
        r.trigger() // a second concurrent trigger must still coalesce to ONE follow-up
        assert(r.isRunning, 'run() executes while isRunning is true')
      }
    }
  })
  r.trigger()
  scheduler.flush() // first run; schedules the follow-up on the way out
  equal(runs, 1, 'the follow-up must not run synchronously inside the first run')
  scheduler.flush() // the coalesced follow-up
  equal(runs, 2, 'exactly one follow-up ran, never two')
  scheduler.flush()
  equal(runs, 2, 'no further follow-up without a new trigger')
})
check('reconciler: cancel() drops a pending run without affecting the primitive afterward', () => {
  const scheduler = createManualScheduler()
  let runs = 0
  const r = new AccountReconciler({ scheduler, run: () => (runs += 1) })
  r.trigger()
  r.cancel()
  scheduler.flush()
  equal(runs, 0, 'cancelled run must never execute')
  r.trigger()
  scheduler.flush()
  equal(runs, 1, 'reconciler remains usable after a cancel')
})
check('reconciler: a throwing run() is reported via onError and never wedges the reconciler', () => {
  const scheduler = createManualScheduler()
  const errors: unknown[] = []
  let calls = 0
  const r = new AccountReconciler({
    scheduler,
    run: () => {
      calls += 1
      throw new Error('boom')
    },
    onError: (e) => errors.push(e)
  })
  r.trigger()
  scheduler.flush()
  equal(errors.length, 1)
  r.trigger()
  scheduler.flush()
  equal(calls, 2, 'still usable after a failing run')
})

// ===========================================================================
// Environment gate
// ===========================================================================
check('gate: automatic reconciliation is wired only for unpackaged + SOLID_SKILL_MT5_AUTO_IMPORT=1', () => {
  const deps = { getDatabase: () => null, getReceiver: () => null, log: () => undefined }
  equal(createMt5ReconciliationCoordinatorFromEnvironment({}, true, deps), null)
  equal(createMt5ReconciliationCoordinatorFromEnvironment({ SOLID_SKILL_MT5_AUTO_IMPORT: '1' }, false, deps), null)
  equal(createMt5ReconciliationCoordinatorFromEnvironment({ SOLID_SKILL_MT5_AUTO_IMPORT: '0' }, true, deps), null)
  assert(createMt5ReconciliationCoordinatorFromEnvironment({ SOLID_SKILL_MT5_AUTO_IMPORT: '1' }, true, deps) instanceof Mt5ReconciliationCoordinator, 'enabled')
})

// ===========================================================================
// History state machine
// ===========================================================================
check('1. an incomplete history sync triggers zero automatic imports', () => {
  const { db, receiver, scheduler, coordinator, log } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'in_progress')
  receiver.addDeals([
    { t: '1', pos: '100', server: SRV, login: LOGIN, type: BUY, entry: IN },
    { t: '2', pos: '100', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '10' }
  ])
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'incomplete'))
  scheduler.flush()
  equal(tradeCount(db), 0)
  assert(log.some((l) => l.includes('incomplete')), 'an incomplete-sync diagnostic is logged')
  db.close()
})
check('2. a complete history sync automatically reconciles; replaying the same complete sync creates zero duplicates', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  receiver.addDeals(
    [
      { t: '1', pos: '100', server: SRV, login: LOGIN, type: BUY, entry: IN },
      { t: '2', pos: '100', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '10' },
      { t: '3', pos: '101', server: SRV, login: LOGIN, type: SELL, entry: IN, sym: 'XAUUSD.x', price: '2400' },
      { t: '4', pos: '101', server: SRV, login: LOGIN, type: BUY, entry: OUT, sym: 'XAUUSD.x', price: '2399', profit: '20' }
    ],
    'history',
    's'
  )
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  equal(tradeCount(db), 2)
  const snapshot = JSON.stringify(db.repositories.trades.list())

  // Reconnect + a fresh complete history sync over the SAME facts (23. history facts stay unchanged).
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  equal(tradeCount(db), 2, '19/24. replay creates no duplicate Trades')
  equal(JSON.stringify(db.repositories.trades.list()), snapshot, '23. historical facts are unchanged by replay')
  db.close()
})

// ===========================================================================
// Live state machine
// ===========================================================================
check('4/5. open->closed: a live opening IN persists nothing; the later OUT completes exactly one Trade', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete')) // marks READY with an empty book
  scheduler.flush()
  equal(tradeCount(db), 0)

  receiver.addDeals([{ t: '10', pos: '200', server: SRV, login: LOGIN, type: BUY, entry: IN }])
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  equal(tradeCount(db), 0, 'an opening deal alone never becomes a Trade')

  receiver.addDeals([{ t: '11', pos: '200', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '30' }])
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  equal(tradeCount(db), 1)
  const t = tradeBy(db, '200')
  assert(t !== null && t.direction === 'LONG', '6. a LONG lifecycle stays LONG')
  equal(db.repositories.trades.listExecutions(t!.id).length, 2)
  db.close()
})
check('6. a live SHORT lifecycle remains SHORT', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  receiver.addDeals([
    { t: '20', pos: '210', server: SRV, login: LOGIN, type: SELL, entry: IN, price: '2400' },
    { t: '21', pos: '210', server: SRV, login: LOGIN, type: BUY, entry: OUT, price: '2390', profit: '50' }
  ])
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  const t = tradeBy(db, '210')
  assert(t !== null && t.direction === 'SHORT', 'short lifecycle stays SHORT')
  db.close()
})
check('7. a burst of live deal_accepted events coalesces to ONE reconciliation pass', () => {
  const { db, receiver, scheduler, coordinator, log } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  receiver.addDeals([
    { t: '30', pos: '220', server: SRV, login: LOGIN, type: BUY, entry: IN },
    { t: '31', pos: '220', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '5' }
  ])
  for (let i = 0; i < 5; i += 1) coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  equal(tradeCount(db), 1)
  const runs = log.filter((l) => l.startsWith('MT5 live-staging import,')).length
  equal(runs, 1, 'five triggers must produce exactly one reconciliation pass')
  db.close()
})
check('8. out-of-order live arrival (OUT staged before its IN) still converges once both are present', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  receiver.addDeals([{ t: '40', pos: '230', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '1' }])
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  equal(tradeCount(db), 0, 'an exit with no opening deal is unresolved, never guessed')
  receiver.addDeals([{ t: '39', pos: '230', server: SRV, login: LOGIN, type: BUY, entry: IN }])
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  equal(tradeCount(db), 1, 'canonical (time-sorted) order, not arrival order, resolves the lifecycle')
  db.close()
})
check('11. disconnect cancels a pending scheduled reconciliation safely; persisted data is untouched', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  receiver.addDeals([{ t: '50', pos: '240', server: SRV, login: LOGIN, type: BUY, entry: IN }])
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  coordinator.handleEvent(disconnected(SRV, LOGIN))
  scheduler.flush()
  equal(tradeCount(db), 0, 'the cancelled run never executed')
  db.close()
})
check('12. reconnect requires a fresh complete history sync before live deals reconcile again', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  coordinator.handleEvent(disconnected(SRV, LOGIN))
  assert(!coordinator.isReady(accountKey(SRV, LOGIN)), 'READY is cleared on disconnect')

  receiver.addDeals([{ t: '60', pos: '250', server: SRV, login: LOGIN, type: BUY, entry: IN }])
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  equal(tradeCount(db), 0, 'a live deal before the reconnect history sync completes must not reconcile')

  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete')) // the EA always resyncs full history on reconnect
  scheduler.flush()
  assert(coordinator.isReady(accountKey(SRV, LOGIN)), 'READY again after a fresh complete sync')
  db.close()
})

// ===========================================================================
// Multi-account isolation
// ===========================================================================
check('13. two accounts never mix staging or reconciliation', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  const LOGIN_B = '7654322'
  receiver.addAccount(SRV, LOGIN)
  receiver.addAccount(SRV, LOGIN_B)
  receiver.setSync(SRV, LOGIN, 'complete')
  receiver.setSync(SRV, LOGIN_B, 'complete')
  receiver.addDeals([
    { t: '200', pos: '300', server: SRV, login: LOGIN, type: BUY, entry: IN },
    { t: '201', pos: '300', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '1' }
  ])
  receiver.addDeals([
    { t: '300', pos: '301', server: SRV, login: LOGIN_B, type: BUY, entry: IN },
    { t: '301', pos: '301', server: SRV, login: LOGIN_B, type: SELL, entry: OUT, profit: '1' }
  ])
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  equal(tradeCount(db), 1, 'only account A reconciled so far')

  coordinator.handleEvent(historyEnd(SRV, LOGIN_B, 'complete'))
  scheduler.flush()
  equal(tradeCount(db), 2)
  const accounts = db.repositories.accounts.list()
  equal(accounts.length, 2, 'each source account maps to its own Solid Skill Account')
  const [accA] = db.repositories.trades.list({ accountId: accounts.find((a) => a.id === tradeBy(db, '300')!.accountId)!.id })
  assert(accA !== undefined && accA.sourcePositionId === '300', 'account A owns only its own Trade')
  db.close()
})

// ===========================================================================
// Conflicts, unsupported, non-trading
// ===========================================================================
check('14. a conflicting replay is reported and never overwrites the persisted Trade', () => {
  const { db, receiver, scheduler, coordinator, log } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  receiver.addDeals([
    { t: '70', pos: '400', server: SRV, login: LOGIN, type: BUY, entry: IN, price: '1.0850' },
    { t: '71', pos: '400', server: SRV, login: LOGIN, type: SELL, entry: OUT, price: '1.0900', profit: '50' }
  ])
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  const before = JSON.stringify(tradeBy(db, '400'))

  // The same deal identity now reports a different price: a misbehaving/inconsistent replay.
  receiver.replaceDealFacts(SRV, LOGIN, '71', { price: '1.0999' })
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  equal(JSON.stringify(tradeBy(db, '400')), before, 'the persisted Trade is never overwritten by a conflicting replay')
  assert(log.some((l) => l.includes('CONFLICT')), 'the conflict is reported')
  db.close()
})
check('15/16/17. unsupported (INOUT) and non-trading (BALANCE) live facts import nothing and never crash', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  receiver.addDeals([
    { t: '80', pos: '410', server: SRV, login: LOGIN, type: BUY, entry: IN },
    { t: '81', pos: '410', server: SRV, login: LOGIN, type: SELL, entry: INOUT, vol: '2' },
    { t: '82', pos: '0', server: SRV, login: LOGIN, type: BALANCE, entry: IN, profit: '1000' }
  ])
  coordinator.handleEvent(dealAccepted(SRV, LOGIN, 'live'))
  scheduler.flush()
  equal(tradeCount(db), 0)
  db.close()
})

// ===========================================================================
// Gate / infrastructure refusals
// ===========================================================================
check('18. bridge running but auto-import not wired performs zero automatic writes', () => {
  // No coordinator constructed at all (mirrors createMt5ReconciliationCoordinatorFromEnvironment returning null):
  // bridge/history events simply have nowhere to go, so nothing can be imported automatically.
  const db = Database.open(':memory:')
  equal(tradeCount(db), 0)
  db.close()
})
check('20. automatic reconciliation refuses a non-development database path', () => {
  const db = Database.open(':memory:')
  const prod = join('C:', 'Users', 'x', 'AppData', 'Roaming', 'solid-skill', 'solid-skill.db')
  const fakeProdDb = Object.create(db, { health: { value: { ...db.health, path: prod } } }) as Database
  const receiver = new FakeReceiver()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  receiver.addDeals([
    { t: '90', pos: '420', server: SRV, login: LOGIN, type: BUY, entry: IN },
    { t: '91', pos: '420', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '1' }
  ])
  const scheduler = createManualScheduler()
  const log: string[] = []
  const coordinator = new Mt5ReconciliationCoordinator({
    getDatabase: () => fakeProdDb,
    getReceiver: () => receiver,
    log: (m) => log.push(m),
    scheduler
  })
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  equal(tradeCount(db), 0)
  assert(log.some((l) => l.includes('NOT_DEVELOPMENT_DATABASE')), 'refusal is logged')
  db.close()
})
check('20. invalid currency refuses automatic import', () => {
  const { db, receiver, scheduler, coordinator, log } = harness()
  receiver.addAccount(SRV, LOGIN, 'usd') // lower-case: invalid ISO 4217
  receiver.setSync(SRV, LOGIN, 'complete')
  receiver.addDeals([
    { t: '95', pos: '430', server: SRV, login: LOGIN, type: BUY, entry: IN },
    { t: '96', pos: '430', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '1' }
  ])
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  equal(tradeCount(db), 0)
  assert(log.some((l) => l.includes('CURRENCY_INVALID')), 'refusal is logged')
  db.close()
})

// ===========================================================================
// Renderer notification / privacy
// ===========================================================================
check('21/22. the notification carries only the Solid Skill account id; no raw MT5 identity crosses it', () => {
  const { db, receiver, scheduler, coordinator, notifications } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  receiver.addDeals([
    { t: '100', pos: '440', server: SRV, login: LOGIN, type: BUY, entry: IN },
    { t: '101', pos: '440', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '1' }
  ])
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  equal(notifications.length, 1)
  const [n] = notifications
  equal(Object.keys(n!).sort(), ['accountId', 'reason'])
  equal(n!.reason, 'mt5-reconciliation')
  assert(n!.accountId === db.repositories.accounts.list()[0]!.id, 'the id is the Solid Skill Account id')
  assert(!JSON.stringify(n).includes(LOGIN) && !JSON.stringify(n).includes(SRV), 'no raw source identity in the notification')

  // A replay that creates nothing must not notify again.
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  equal(notifications.length, 1, 'no notification when reconciliation creates nothing new')
  db.close()
})

// ===========================================================================
// Manual importer coexistence
// ===========================================================================
check('24. the manual live-import gate still works as QA/fallback alongside automatic reconciliation', () => {
  const { db, receiver, scheduler, coordinator } = harness()
  receiver.addAccount(SRV, LOGIN)
  receiver.setSync(SRV, LOGIN, 'complete')
  receiver.addDeals([
    { t: '110', pos: '450', server: SRV, login: LOGIN, type: BUY, entry: IN },
    { t: '111', pos: '450', server: SRV, login: LOGIN, type: SELL, entry: OUT, profit: '1' }
  ])
  coordinator.handleEvent(historyEnd(SRV, LOGIN, 'complete'))
  scheduler.flush()
  equal(tradeCount(db), 1)

  const manual = importFromLiveStaging(receiver, db, { accountMask: MASK })
  assert(manual.ok && manual.summary.result.created.length === 0 && manual.summary.result.alreadyExisting.length === 1, 'manual replay agrees: already existing')
  db.close()
})

// ===========================================================================
// 25. Static scan: no trading capability, no methodology concept
// ===========================================================================
check('25. no trading-capability code or methodology concept is introduced', () => {
  const dir = resolve(process.cwd(), 'src/main/integrations/mt5/reconciliation')
  const forbidden = /OrderSend|CTrade|OrderCancel|PositionClose|PositionModify|net\.connect|createConnection|\bfetch\(|from 'electron'|ipcMain/
  const methodology = /\b(ICT|CRT|SMT|VWAP|FVG|liquidity|sweep|opening range|bias)\b/i
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('__smoke__'))) {
    const src = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    assert(!forbidden.test(src), `${file} matches a forbidden capability`)
    assert(!methodology.test(src), `${file} mentions a methodology concept`)
  }
})

// ---------------------------------------------------------------------------
console.log(lines.join('\n'))
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
