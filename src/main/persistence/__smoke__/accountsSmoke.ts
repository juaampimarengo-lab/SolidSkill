/**
 * Active-account smoke suite (Checkpoint 012B-3). Development tooling only.
 * Invoked from smoke.ts inside the Electron main-process runtime against
 * TEMPORARY databases and preference files. Also exercises the renderer's pure
 * scoping/calendar helpers so persisted account -> DTO -> screen data is
 * checked without a window.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Database } from '../database'
import type { NewTrade } from '../repositories/trades'
import { AccountService } from '../../accounts/accountService'
import { FileActiveAccountStore, MemoryActiveAccountStore } from '../../accounts/activeAccountStore'
import { createAccountHandlers } from '../../ipc/accountHandlers'
import { seedDevelopmentStrategies } from '../../strategies/devSeed'
import { seedDevelopmentTrading } from '../../trading/devSeed'
import { TradingService } from '../../trading/tradingService'
import { ACCOUNT_CHANNELS } from '../../../shared/ipc/accounts'
import type { AccountListDto } from '../../../shared/ipc/accounts'
import { buildCalendarMonth, groupByDate } from '../../../renderer/src/lib/calendar'
import { toTradingData } from '../../../renderer/src/lib/tradingScope'
import { createLatestGate } from '../../../renderer/src/lib/latest'
import type { SmokeHelpers } from './tradingSmoke'

const MT5_LOGIN = '9988514'
const MT5_SERVER = 'BrokerCo-Live-7'

export function runAccountsSmoke(h: SmokeHelpers): void {
  const { check, equal } = h
  const scratch = mkdtempSync(join(tmpdir(), 'solid-skill-accounts-'))
  const prefPath = join(scratch, 'preferences.json')

  const mt5Trade = (date: string, id: string, direction: 'LONG' | 'SHORT'): Omit<NewTrade, 'accountId'> => ({
    sourceTradeId: id,
    analyticalTradeDate: date,
    instrument: 'NAS100.x',
    direction,
    quantity: '1',
    openedAt: Date.UTC(2026, 8, 9, 14, 0, 0),
    closedAt: Date.UTC(2026, 8, 9, 15, 0, 0),
    avgEntryPrice: '100',
    avgExitPrice: '101',
    grossPnl: '10',
    netPnl: '10',
    executions: [
      { sourceExecutionId: `${id}-a`, executedAt: Date.UTC(2026, 8, 9, 14, 0, 0), side: 'BUY', quantity: '1', price: '100' },
      { sourceExecutionId: `${id}-b`, executedAt: Date.UTC(2026, 8, 9, 15, 0, 0), side: 'SELL', quantity: '1', price: '101' }
    ]
  })

  function openBoth(path: string): { db: Database; demoId: string; mt5Id: string } {
    const db = Database.open(path, { clock: h.makeClock() })
    seedDevelopmentStrategies(db)
    seedDevelopmentTrading(db)
    const { accounts, trades } = db.repositories
    const demo = accounts.list().find((a) => a.sourcePlatform === 'dev-fixture')
    if (demo === undefined) throw new Error('demo account missing')
    let mt5 = accounts.findBySource('MT5', MT5_LOGIN)
    if (mt5 === null) {
      mt5 = accounts.create({
        displayName: 'MT5 · ***514',
        sourcePlatform: 'MT5',
        sourceAccountId: MT5_LOGIN,
        currency: 'USD',
        timezone: null
      })
      trades.createTrade({ accountId: mt5.id, ...mt5Trade('2026-09-08', 'm1', 'LONG') })
      trades.createTrade({ accountId: mt5.id, ...mt5Trade('2026-09-21', 'm2', 'SHORT') })
    }
    return { db, demoId: demo.id, mt5Id: mt5.id }
  }

  const path = h.newDbPath()
  const first = openBoth(path)
  const { demoId, mt5Id } = first
  let db = first.db
  const service = new AccountService(db, new MemoryActiveAccountStore())
  const trading = new TradingService(db)

  check('accounts.list returns both persisted accounts by display name and id', () => {
    const list = service.list()
    equal(list.accounts.map((a) => a.displayName), ['Demo Account 50K', 'MT5 · ***514'])
    equal(list.accounts.map((a) => a.id), [demoId, mt5Id])
  })

  check('renderer DTO does not expose raw MT5 login / server / source identity', () => {
    const json = JSON.stringify(service.list()) + JSON.stringify(trading.list())
    equal(json.includes(MT5_LOGIN), false, 'login')
    equal(json.includes(MT5_SERVER), false, 'server')
    equal(json.includes('sourceAccountId'), false, 'source field')
    equal(Object.keys(service.list().accounts[1] as object).sort(), ['currency', 'displayName', 'id', 'timezone'])
  })

  check('active account is a persisted Solid Skill UUID (not a name or index)', () => {
    const list = service.setActive(mt5Id)
    equal(list.activeAccountId, mt5Id)
    equal(/^[0-9a-f-]{36}$/i.test(list.activeAccountId ?? ''), true, 'uuid shape')
  })

  const full = trading.list()
  check('selecting B scopes Journal data to B; switching back restores A (no fixtures)', () => {
    const b = toTradingData(full, mt5Id)
    equal(b.account?.id, mt5Id)
    equal(b.trades.length, 2)
    equal(b.trades.every((t) => t.accountId === mt5Id), true)
    const a = toTradingData(full, demoId)
    equal(a.trades.length, 17)
    equal(a.trades.every((t) => t.accountId === demoId), true)
    equal(toTradingData(full, mt5Id).trades.length, 2)
    equal(b.allTrades.length, 19, 'strategy views keep the global universe')
  })

  check('Calendar groups only the active account trades', () => {
    const b = toTradingData(full, mt5Id)
    equal([...groupByDate(b.trades).keys()].sort(), ['2026-09-08', '2026-09-21'])
    const month = buildCalendarMonth({ year: 2026, month: 9 }, groupByDate(b.trades), b.noteDates, '2026-09-21')
    const populated = month.weeks
      .flat()
      .filter((c) => c.trades > 0)
      .map((c) => c.dateKey)
    equal(populated, ['2026-09-08', '2026-09-21'])
  })

  check('Day Review reads (active account, date); the same date of another account is separate', () => {
    const b = trading.getDay(mt5Id, '2026-09-08')
    equal(b.accountId, mt5Id)
    equal(b.trades.length, 1)
    equal(trading.getDay(demoId, '2026-09-08').trades.every((t) => t.accountId === demoId), true)
  })

  check('Trade Review still resolves by Trade id regardless of the active account', () => {
    const demoTrade = full.trades.find((t) => t.accountId === demoId)
    if (demoTrade === undefined) throw new Error('no demo trade')
    service.setActive(mt5Id)
    equal(trading.getDetail(demoTrade.id).trade.accountId, demoId)
    equal(service.list().activeAccountId, mt5Id, 'opening a trade does not change the active account')
  })

  check('a zero-trade account renders an empty, valid scope', () => {
    const empty = db.repositories.accounts.create({ displayName: 'Empty', sourcePlatform: 'MT5', sourceAccountId: 'x1', currency: 'USD' })
    const scoped = toTradingData(trading.list(), empty.id)
    equal(scoped.account?.id, empty.id)
    equal(scoped.trades.length, 0)
    equal(scoped.noteDates.size, 0)
    db.repositories.accounts.setArchived(empty.id, true)
  })

  check('switching accounts performs no writes to historical Trade facts', () => {
    const snapshot = (): string => {
      const raw = new DatabaseSync(path)
      try {
        return ['trades', 'executions', 'trade_rule_evaluations', 'trade_notes', 'day_notes']
          .map((t) =>
            raw
              .prepare(`SELECT * FROM ${t} ORDER BY 1`)
              .all()
              .map((r) => JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)))
              .join('\n')
          )
          .join('\n---\n')
      } finally {
        raw.close()
      }
    }
    const before = snapshot()
    for (const id of [demoId, mt5Id, demoId, mt5Id]) {
      service.setActive(id)
      service.list()
      trading.list()
    }
    equal(snapshot() === before, true, 'trade tables unchanged')
  })

  check('preference survives restart (reopened DB + fresh service + file store)', () => {
    new AccountService(db, new FileActiveAccountStore(prefPath)).setActive(mt5Id)
    db.close()
    const reopened = openBoth(path)
    equal(new AccountService(reopened.db, new FileActiveAccountStore(prefPath)).list().activeAccountId, mt5Id)
    equal(reopened.mt5Id, mt5Id, 'account reused, not recreated')
    db = reopened.db
  })

  check('missing / malformed remembered account falls back safely to the first account', () => {
    equal(new AccountService(db, new MemoryActiveAccountStore('no-such-account')).list().activeAccountId, demoId)
    equal(new AccountService(db, new MemoryActiveAccountStore(null)).list().activeAccountId, demoId)
    writeFileSync(prefPath, '{not json')
    equal(new AccountService(db, new FileActiveAccountStore(prefPath)).list().activeAccountId, demoId)
    writeFileSync(prefPath, JSON.stringify({ activeAccountId: 42 }))
    equal(new AccountService(db, new FileActiveAccountStore(prefPath)).list().activeAccountId, demoId)
    equal(new AccountService(db, new FileActiveAccountStore(join(scratch, 'missing.json'))).list().activeAccountId, demoId)
  })

  check('a remembered account that was archived falls back; setActive rejects unknown ids', () => {
    const svc = new AccountService(db, new MemoryActiveAccountStore())
    svc.setActive(mt5Id)
    db.repositories.accounts.setArchived(mt5Id, true)
    equal(svc.list().activeAccountId, demoId)
    let code = ''
    try {
      svc.setActive('nope')
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    equal(code, 'NOT_FOUND')
    db.repositories.accounts.setArchived(mt5Id, false)
  })

  check('zero accounts: null active, empty list, empty trading scope (no crash)', () => {
    const emptyDb = Database.open(h.newDbPath(), { clock: h.makeClock() })
    const list = new AccountService(emptyDb, new MemoryActiveAccountStore()).list()
    equal(list, { accounts: [], activeAccountId: null } satisfies AccountListDto)
    const scoped = toTradingData(new TradingService(emptyDb).list(), list.activeAccountId)
    equal([scoped.account, scoped.trades.length], [null, 0])
    emptyDb.close()
  })

  check('IPC handlers: validate input, map errors, PERSISTENCE_UNAVAILABLE without a database', () => {
    const svc = new AccountService(db, new MemoryActiveAccountStore())
    const handlers = createAccountHandlers({ getService: () => svc, log: () => undefined })
    equal(handlers[ACCOUNT_CHANNELS.setActive]({ accountId: 1 }).ok, false)
    const missing = handlers[ACCOUNT_CHANNELS.setActive]('nope')
    equal(!missing.ok && missing.error.code, 'NOT_FOUND')
    const good = handlers[ACCOUNT_CHANNELS.setActive](mt5Id)
    equal(good.ok && (good.data as AccountListDto).activeAccountId, mt5Id)
    const down = createAccountHandlers({ getService: () => null, log: () => undefined })
    for (const channel of Object.values(ACCOUNT_CHANNELS)) {
      const r = down[channel]('x')
      equal(!r.ok && r.error.code, 'PERSISTENCE_UNAVAILABLE', channel)
    }
  })

  check('rapid A -> B: a superseded response is dropped (latest wins)', () => {
    const gate = createLatestGate()
    const isA = gate.begin()
    const isB = gate.begin()
    equal([isA(), isB()], [false, true])
    const isC = gate.begin()
    equal([isB(), isC()], [false, true])
  })

  db.close()
  rmSync(scratch, { recursive: true, force: true })
}
