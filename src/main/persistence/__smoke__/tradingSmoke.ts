/**
 * Trading application/IPC smoke suite (Checkpoint 011B-2). Development tooling
 * only — NOT imported by the application. It is invoked from smoke.ts, so it
 * runs inside the real Electron main-process runtime against TEMPORARY
 * databases. It also exercises the renderer's pure mapping helpers (decimal,
 * compliance, time formatting) so persistence → DTO → presentation is checked
 * end to end without a window.
 */
import { DatabaseSync } from 'node:sqlite'
import { Database } from '../database'
import type { Clock } from '../ids'
import { createTradeHandlers } from '../../ipc/tradeHandlers'
import { seedDevelopmentStrategies } from '../../strategies/devSeed'
import { StrategyService } from '../../strategies/strategyService'
import { DEV_ACCOUNT_SOURCE_ID, DEV_PLATFORM, seedDevelopmentTrading } from '../../trading/devSeed'
import { SEED_DAY_NOTES, SEED_TRADES } from '../../trading/devSeedData'
import { TradingService } from '../../trading/tradingService'
import { ServiceError } from '../../serviceError'
import type { IpcResult } from '../../../shared/ipc/result'
import { TRADE_CHANNELS } from '../../../shared/ipc/trades'
import type {
  DayDto,
  RuleEvaluationResultDto,
  RuleStateDto,
  TradeDetailDto,
  TradeListDto,
  TradeSummaryDto
} from '../../../shared/ipc/trades'
import { summarizeCounts } from '../../../shared/compliance'
import { formatCompliance, summarizeRules } from '../../../renderer/src/lib/compliance'
import { sumDecimals } from '../../../renderer/src/lib/decimal'
import { aggregateDay } from '../../../renderer/src/lib/dayAggregate'
import { buildCalendarMonth, groupByDate } from '../../../renderer/src/lib/calendar'
import { clockTime, dateLabel, durationLabel, tradeOutcome } from '../../../renderer/src/lib/tradeView'
import { tradesForStrategy } from '../../../renderer/src/lib/strategyTrades'

export interface SmokeHelpers {
  check: (name: string, fn: () => void) => void
  equal: <T>(actual: T, expected: T, label?: string) => void
  throws: (fn: () => unknown, pattern: RegExp) => void
  newDbPath: () => string
  makeClock: () => Clock
}

export function runTradingSmoke(h: SmokeHelpers): void {
  const { check, equal, throws } = h

  const must = <T>(value: T | null | undefined | false, label: string): T => {
    if (value === null || value === undefined || value === false) throw new Error(`${label} is missing`)
    return value
  }

  function openSeeded(path: string): { db: Database; trading: TradingService; strategies: StrategyService } {
    const db = Database.open(path, { clock: h.makeClock() })
    seedDevelopmentStrategies(db)
    return { db, trading: new TradingService(db), strategies: new StrategyService(db) }
  }

  const tradeOf = (list: TradeListDto, date: string, instrument: string, direction?: string): TradeSummaryDto =>
    must(
      list.trades.find(
        (t) => t.tradeDate === date && t.instrument === instrument && (direction === undefined || t.direction === direction)
      ),
      `trade ${date} ${instrument}`
    )

  function counts(path: string): Record<string, number> {
    const raw = new DatabaseSync(path)
    try {
      const out: Record<string, number> = {}
      for (const table of ['accounts', 'trades', 'executions', 'trade_notes', 'day_notes', 'trade_rule_evaluations', 'strategies', 'strategy_versions']) {
        out[table] = Number((raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number | bigint }).n)
      }
      return out
    } finally {
      raw.close()
    }
  }

  const seedPath = h.newDbPath()
  const expectedExecutions = SEED_TRADES.reduce((n, t) => n + t.executions.length, 0)
  const expectedEvaluations = ((): number => {
    // Each seed trade gets one evaluation per rule of its exact version.
    const ruleCount: Record<string, number> = { 'Strategy Alpha|2': 4, 'Strategy Alpha|3': 5, 'Strategy Beta|1': 5 }
    return SEED_TRADES.reduce((n, t) => n + (ruleCount[`${t.strategy}|${t.version}`] ?? 0), 0)
  })()

  // ---- development seed: applied once, idempotent, isolated ------------------
  {
    const { db } = openSeeded(seedPath)
    check('trading seed: seeds 17 trades / all executions / notes / evaluations exactly once', () => {
      const first = seedDevelopmentTrading(db)
      equal(first, { status: 'seeded', trades: SEED_TRADES.length })
      const c = counts(seedPath)
      equal(c['accounts'], 1, 'accounts')
      equal(c['trades'], 17, 'trades')
      equal(c['executions'], expectedExecutions, 'executions')
      equal(c['trade_notes'], 17, 'trade notes')
      equal(c['day_notes'], Object.keys(SEED_DAY_NOTES).length, 'day notes')
      equal(c['trade_rule_evaluations'], expectedEvaluations, 'evaluations')
    })
    check('trading seed: a second run in the same session writes nothing', () => {
      equal(seedDevelopmentTrading(db), { status: 'already-seeded' })
      equal(counts(seedPath)['trades'], 17)
    })
    db.close()
  }
  check('B second start: reopening + re-seeding leaves every table unchanged (no duplicates)', () => {
    const before = counts(seedPath)
    const db = Database.open(seedPath)
    try {
      equal(seedDevelopmentStrategies(db), false)
      equal(seedDevelopmentTrading(db), { status: 'already-seeded' })
    } finally {
      db.close()
    }
    equal(counts(seedPath), before)
  })
  check('trading seed: source identifiers are plainly fake and the account carries no credentials', () => {
    const db = Database.open(seedPath)
    try {
      const account = must(db.repositories.accounts.findBySource(DEV_PLATFORM, DEV_ACCOUNT_SOURCE_ID), 'dev account')
      equal(account.sourcePlatform, 'dev-fixture')
      const raw = new DatabaseSync(seedPath)
      try {
        const rows = raw.prepare('SELECT source_trade_id FROM trades').all() as { source_trade_id: string }[]
        equal(rows.every((r) => r.source_trade_id.startsWith('dev-fixture:')), true)
        const cols = raw.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]
        equal(cols.some((c) => /secret|password|token|credential|api/i.test(c.name)), false)
      } finally {
        raw.close()
      }
    } finally {
      db.close()
    }
  })
  check('trading seed: skipped (nothing written) when the demo strategies are absent', () => {
    const db = Database.open(h.newDbPath())
    try {
      const result = seedDevelopmentTrading(db)
      equal(result.status, 'skipped')
      equal(db.repositories.accounts.list({ includeArchived: true }).length, 0)
      equal(db.repositories.trades.list().length, 0)
    } finally {
      db.close()
    }
  })

  // ---- list / detail model over the seeded universe --------------------------
  const { db, trading, strategies } = (() => {
    const opened = Database.open(seedPath, { clock: h.makeClock() })
    return { db: opened, trading: new TradingService(opened), strategies: new StrategyService(opened) }
  })()
  const list = trading.list()

  check('A list: 17 trades chronological by analytical date then open time; one dev account', () => {
    equal(list.trades.length, 17)
    equal(list.accounts.length, 1)
    equal(list.accounts[0]?.timezone, 'America/New_York')
    const keys = list.trades.map((t) => `${t.tradeDate} ${t.openedAt}`)
    equal(keys, [...keys].sort())
    equal(list.trades[0]?.tradeDate, '2026-08-03')
    equal(list.trades[16]?.tradeDate, '2026-09-16')
  })
  check('A calendar: no persisted trade after Sep 16 (no fake realized activity later)', () => {
    equal(list.trades.every((t) => t.tradeDate <= '2026-09-16'), true)
  })
  check('list rows carry stable ids and never leak persistence rows (no BigInt; JSON round-trips exactly)', () => {
    const round = JSON.parse(JSON.stringify(list)) as unknown
    equal(round, list as unknown)
    equal(new Set(list.trades.map((t) => t.id)).size, 17)
    equal('sourcePlatform' in (list.trades[0] as object), false)
    equal('executions' in (list.trades[0] as object), false)
  })
  check('financial values cross as exact decimal strings; unreported costs stay null (never zero)', () => {
    const a = tradeOf(list, '2026-09-12', 'NQ')
    equal(
      [a.grossPnl, a.commission, a.netPnl, a.avgEntry, a.avgExit, a.quantity, a.plannedR, a.realizedR],
      ['530', '-5', '525', '19820', '19846.5', '1', '2', '2.1']
    )
    equal([a.fees, a.swap], [null, null])
    equal(typeof a.netPnl, 'string')
  })
  check('timestamps present in the account timezone: seeded 09:15:22 New York reads back as 09:15:22', () => {
    const a = tradeOf(list, '2026-09-12', 'NQ')
    equal(clockTime(a.openedAt, a.timezone), '09:15:22')
    equal(durationLabel(a), '22m 48s')
    equal(dateLabel(a.tradeDate), 'Sep 12')
  })
  check('every fixture value survived persistence exactly (net, gross, compliance counts, strategy version)', () => {
    const rows = [...list.trades]
    for (const seed of SEED_TRADES) {
      const dayRows = rows.filter((t) => t.tradeDate === seed.date && t.instrument === seed.instrument && t.netPnl === seed.net)
      const row = must(dayRows[0], `seed ${seed.key}`)
      equal(row.grossPnl, seed.gross, `${seed.key} gross`)
      equal(row.direction, seed.direction === 'LONG' ? 'Long' : 'Short', `${seed.key} direction`)
      equal(row.strategy?.versionNumber, seed.version, `${seed.key} version`)
      const states = Object.values(seed.rules)
      const expected = summarizeCounts({
        pass: states.filter((s) => s === 'Pass').length,
        fail: states.filter((s) => s === 'Fail').length,
        na: states.filter((s) => s === 'N/A').length,
        unreviewed: states.filter((s) => s === 'Unreviewed').length
      })
      equal(summarizeCounts(row.compliance), expected, `${seed.key} compliance`)
    }
  })
  check('break-even classification (temporary threshold) reproduces the three fixture break-even trades', () => {
    const be = list.trades.filter((t) => tradeOutcome(t) === 'break-even').map((t) => t.netPnl)
    equal(be.sort(), ['-2.5', '-4.5', '-5'])
  })

  const trades = { c: tradeOf(list, '2026-09-15', 'NQ'), d: tradeOf(list, '2026-09-15', 'MNQ'), b: tradeOf(list, '2026-09-12', 'ES') }

  check('G multi-execution LONG: BUY,BUY,SELL,SELL persists and reads back as ONE Long trade with FOUR executions', () => {
    const detail = trading.getDetail(trades.c.id)
    equal(detail.trade.direction, 'Long')
    equal(detail.executions.map((e) => e.side), ['BUY', 'BUY', 'SELL', 'SELL'])
    equal(detail.executions.length, 4)
    equal(list.trades.filter((t) => t.tradeDate === '2026-09-15' && t.instrument === 'NQ').length, 1)
    equal(detail.executions.map((e) => clockTime(e.executedAt, detail.trade.timezone)), ['09:41:13', '09:42:08', '09:51:27', '09:56:44'])
  })
  check('H SHORT safety: SELL entry / BUY exit stays Short in persistence and DTO (never derived from the last execution)', () => {
    const b = trading.getDetail(trades.b.id)
    equal(b.executions.map((e) => e.side), ['SELL', 'BUY'])
    equal(b.trade.direction, 'Short')
    const d = trading.getDetail(trades.d.id)
    equal(d.executions.map((e) => e.side), ['SELL', 'BUY', 'BUY'])
    equal(d.trade.direction, 'Short')
    const raw = new DatabaseSync(seedPath)
    try {
      const row = raw.prepare('SELECT direction FROM trades WHERE id = ?').get(b.trade.id) as { direction: string }
      equal(row.direction, 'SHORT')
    } finally {
      raw.close()
    }
  })
  check('detail: exact strategy version, frozen rules by group, both notes and same-day siblings', () => {
    const detail = trading.getDetail(trades.c.id)
    const strategy = must(detail.strategy, 'strategy')
    equal(strategy.strategyName, 'Strategy Alpha')
    equal(strategy.versionNumber, 3)
    equal(strategy.groups.map((g) => g.name), ['Group A', 'Group B'])
    equal(strategy.groups.flatMap((g) => g.rules.map((r) => `${r.name}:${r.state}`)), [
      'Rule A:Pass', 'Rule B:Pass', 'Rule C:Fail', 'Rule D:Pass', 'Rule E:N/A'
    ])
    equal(detail.tradeNote.startsWith('Scaled in on the retest'), true)
    equal(detail.dayNote, SEED_DAY_NOTES['2026-09-15'])
    equal(detail.siblings.map((t) => t.id), [trades.c.id, trades.d.id])
    equal(JSON.parse(JSON.stringify(detail)) as unknown, detail as unknown)
  })
  check('day view: (account, analytical date) trades + Day Note; empty day is a real empty result', () => {
    const accountId = must(list.accounts[0], 'account').id
    const day = trading.getDay(accountId, '2026-09-15')
    equal(day.trades.map((t) => t.id), [trades.c.id, trades.d.id])
    equal(day.accountName, 'Demo Account 50K')
    equal(day.dayNote, SEED_DAY_NOTES['2026-09-15'])
    equal(trading.getDay(accountId, '2026-09-17').trades, [])
    throws(() => trading.getDay('missing-account', '2026-09-15'), /Account not found/)
  })
  check('Calendar / Day Review aggregation agrees and populated days come only from persisted trades', () => {
    const byDate = groupByDate(list.trades)
    const sept = buildCalendarMonth({ year: 2026, month: 9 }, byDate, new Set(list.daysWithNotes.map((d) => d.date)), '2026-09-21')
    const populated = sept.weeks.flat().filter((c) => c.inMonth && c.trades > 0).map((c) => c.dateKey)
    equal(populated, ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-08', '2026-09-10', '2026-09-12', '2026-09-14', '2026-09-15', '2026-09-16'])
    equal(sept.weeks.length, 5)
    equal(sept.weeks[0]?.slice(0, 3).map((c) => c.date), [30, 31, 1])
    const day15 = sept.weeks.flat().find((c) => c.dateKey === '2026-09-15')
    const agg15 = aggregateDay(trading.getDay(must(list.accounts[0], 'a').id, '2026-09-15').trades)
    equal(day15?.result, agg15.netPnl)
    equal(day15?.result, '2002')
    equal(sept.monthlyStats.result, sumDecimals(list.trades.filter((t) => t.tradeDate.startsWith('2026-09')).map((t) => t.netPnl)))
    equal(sept.weeks.flat().some((c) => c.inMonth && c.date > 16 && c.trades > 0), false)
    const noteDay = sept.weeks.flat().find((c) => c.dateKey === '2026-09-15')
    equal(noteDay?.hasJournalEntry, true)
    const aug = buildCalendarMonth({ year: 2026, month: 8 }, byDate, new Set(), '2026-09-21')
    equal(aug.weeks.length, 6)
  })

  // ---- E/F: rename + new version stability -----------------------------------
  check('E rename stability: renaming Strategy Alpha does not detach trades; same strategy id and exact v3', () => {
    const before = trading.getDetail(trades.c.id).strategy
    const alpha = must(strategies.list().find((s) => s.name === 'Strategy Alpha'), 'alpha')
    strategies.updateDetails({ strategyId: alpha.id, name: 'Opening Model', description: alpha.description })
    const after = trading.list()
    const row = tradeOf(after, '2026-09-15', 'NQ')
    equal(row.strategy?.strategyId, alpha.id)
    equal(row.strategy?.versionId, before?.versionId)
    equal(row.strategy?.versionNumber, 3)
    equal(row.strategy?.strategyName, 'Opening Model')
    const detail = trading.getDetail(trades.c.id)
    equal(detail.strategy?.groups, before?.groups)
    // Strategies -> Trades selects by stable id and still finds every Alpha trade.
    equal(tradesForStrategy(alpha.id, after.trades).length, SEED_TRADES.filter((t) => t.strategy === 'Strategy Alpha').length)
    equal(tradesForStrategy('an-unrelated-id', after.trades).length, 0)
  })
  check('F newer version stability: publishing Alpha v4 leaves T1 on v3 with unchanged v3 evaluations', () => {
    const alpha = must(strategies.list().find((s) => s.name === 'Opening Model'), 'alpha')
    const beforeDetail = trading.getDetail(trades.c.id)
    const idsOf = (): string[] => tradesForStrategy(alpha.id, trading.list().trades).map((r) => r.trade.id).sort()
    const beforeIds = idsOf()
    const draft = must(strategies.beginDraft(alpha.id).draft, 'draft')
    const rule = must(draft.groups[0]?.rules[0], 'rule')
    strategies.editDraft(alpha.id, { type: 'updateRule', ruleId: rule.id, name: rule.name, kind: rule.kind, description: 'Rule A — v4 wording' })
    const published = strategies.publishDraft(alpha.id)
    equal(published.versions.map((v) => v.number), [1, 2, 3, 4])
    const afterDetail = trading.getDetail(trades.c.id)
    equal(afterDetail.strategy?.versionNumber, 3)
    equal(afterDetail.strategy?.versionId, beforeDetail.strategy?.versionId)
    equal(afterDetail.strategy?.groups, beforeDetail.strategy?.groups)
    equal(idsOf(), beforeIds)
    equal(beforeIds.length, SEED_TRADES.filter((t) => t.strategy === 'Strategy Alpha').length)
    equal(tradesForStrategy(alpha.id, trading.list().trades).every((r) => r.trade.strategy?.versionNumber !== 4), true)
  })

  // ---- rule evaluation writes -----------------------------------------------
  check('rule evaluation write persists and updates the canonical counts; only the trade\'s own version is allowed', () => {
    const detail = trading.getDetail(trades.c.id)
    const ruleC = must(detail.strategy?.groups.flatMap((g) => g.rules).find((r) => r.name === 'Rule C'), 'Rule C')
    const result: RuleEvaluationResultDto = trading.updateRuleEvaluation(trades.c.id, ruleC.ruleId, 'Pass')
    equal(result.compliance, { pass: 4, fail: 0, na: 1, unreviewed: 0 })
    equal(trading.getDetail(trades.c.id).strategy?.groups.flatMap((g) => g.rules).find((r) => r.name === 'Rule C')?.state, 'Pass')
    // back to the seeded state
    trading.updateRuleEvaluation(trades.c.id, ruleC.ruleId, 'Fail')

    // A rule of the SAME strategy's newer published version (v4) is refused.
    const alpha = must(strategies.list().find((s) => s.name === 'Opening Model'), 'alpha')
    const v4 = must(alpha.versions.find((v) => v.number === 4), 'v4')
    const v4Rule = must(v4.groups[0]?.rules[0], 'v4 rule')
    throws(() => trading.updateRuleEvaluation(trades.c.id, v4Rule.id, 'Pass'), /does not belong to the strategy version/)
    // A rule of another strategy is refused too.
    const beta = must(strategies.list().find((s) => s.name === 'Strategy Beta'), 'beta')
    const betaRule = must(beta.versions[0]?.groups[0]?.rules[0], 'beta rule')
    throws(() => trading.updateRuleEvaluation(trades.c.id, betaRule.id, 'Pass'), /does not belong to the strategy version/)
    throws(() => trading.updateRuleEvaluation('missing-trade', ruleC.ruleId, 'Pass'), /Trade not found/)
    // Nothing changed on the refused writes.
    equal(trading.getDetail(trades.c.id).trade.compliance, { pass: 3, fail: 1, na: 1, unreviewed: 0 })
  })
  check('repository guard: setState refuses a rule outside the trade\'s associated version', () => {
    const alpha = must(strategies.list().find((s) => s.name === 'Opening Model'), 'alpha')
    const v4Rule = must(alpha.versions.find((v) => v.number === 4)?.groups[0]?.rules[0], 'v4 rule')
    throws(() => db.repositories.evaluations.setState(trades.c.id, v4Rule.id, 'PASS'), /strategy version/)
  })

  // ---- I: compliance edge cases through persistence and renderer mapping ------
  check('I compliance edge cases survive persistence and renderer mapping', () => {
    const db2 = Database.open(h.newDbPath(), { clock: h.makeClock() })
    try {
      const svc = new StrategyService(db2)
      const tsvc = new TradingService(db2)
      const s = svc.create({ name: 'Edge Strategy', description: '' })
      const group = must(svc.editDraft(s.id, { type: 'addGroup', name: 'G' }).draft?.groups[0], 'group')
      for (let i = 1; i <= 8; i += 1) {
        svc.editDraft(s.id, { type: 'addRule', groupId: group.id, name: `R${i}`, kind: 'Required', description: '' })
      }
      const published = svc.publishDraft(s.id)
      const version = must(published.versions[0], 'v1')
      const account = db2.repositories.accounts.create({ displayName: 'Edge', sourcePlatform: 'dev-fixture', sourceAccountId: 'edge', currency: 'USD', timezone: 'UTC' })
      const ruleIds = must(published.versions[0], 'v1').groups[0]!.rules.map((r) => r.id)

      const cases: Array<{ name: string; states: RuleStateDto[]; percent: number | null; complete: boolean; text: string }> = [
        { name: '4P/1F/2NA/1U', states: ['Pass', 'Pass', 'Pass', 'Pass', 'Fail', 'N/A', 'N/A', 'Unreviewed'], percent: 80, complete: false, text: '80%' },
        { name: 'only Pass', states: Array(8).fill('Pass') as RuleStateDto[], percent: 100, complete: true, text: '100%' },
        { name: 'Pass + Unreviewed', states: ['Pass', 'Pass', 'Unreviewed', 'Unreviewed', 'Unreviewed', 'Unreviewed', 'Unreviewed', 'Unreviewed'], percent: 100, complete: false, text: '100%' },
        { name: 'only Unreviewed', states: Array(8).fill('Unreviewed') as RuleStateDto[], percent: null, complete: false, text: '—' },
        { name: 'only N/A', states: Array(8).fill('N/A') as RuleStateDto[], percent: null, complete: true, text: '—' }
      ]
      cases.forEach((c, index) => {
        const t = db2.repositories.trades.createTrade({
          accountId: account.id,
          analyticalTradeDate: '2026-01-05',
          instrument: 'X',
          direction: 'LONG',
          quantity: '1',
          openedAt: 1_767_600_000_000 + index * 60_000,
          closedAt: 1_767_600_030_000 + index * 60_000,
          avgEntryPrice: '10',
          avgExitPrice: '11',
          grossPnl: '1',
          netPnl: '1',
          executions: [
            { executedAt: 1_767_600_000_000 + index * 60_000, side: 'BUY', quantity: '1', price: '10' },
            { executedAt: 1_767_600_030_000 + index * 60_000, side: 'SELL', quantity: '1', price: '11' }
          ]
        })
        db2.repositories.trades.associateStrategyVersion(t.id, version.id)
        c.states.forEach((state, i) => tsvc.updateRuleEvaluation(t.id, ruleIds[i] as string, state))
      })
      const rows = tsvc.list().trades
      cases.forEach((c, index) => {
        const row = must(rows[index], c.name)
        const summary = summarizeCounts(row.compliance)
        equal([summary.percent, summary.reviewComplete, formatCompliance(summary)], [c.percent, c.complete, c.text], c.name)
        // The renderer's per-state mapping agrees with the shared count derivation.
        equal(summarizeRules(c.states).percent, c.percent, `${c.name} (states)`)
      })
      // P&L is never an input: same rule results, opposite P&L, same compliance.
      equal(summarizeCounts({ pass: 4, fail: 1, na: 2, unreviewed: 1 }).percent, 80)
    } finally {
      db2.close()
    }
  })

  // ---- notes --------------------------------------------------------------------
  check('C Trade Note persists across reopen', () => {
    trading.updateTradeNote(trades.c.id, 'Edited trade note — persisted')
    db.close()
    const reopened = Database.open(seedPath)
    try {
      equal(new TradingService(reopened).getDetail(trades.c.id).tradeNote, 'Edited trade note — persisted')
    } finally {
      reopened.close()
    }
  })
  const db3 = Database.open(seedPath, { clock: h.makeClock() })
  const trading3 = new TradingService(db3)
  check('D Day Note is one persisted note per (account, date), visible from Day Review and Trade Review, and survives reopen', () => {
    const accountId = must(trading3.list().accounts[0], 'account').id
    trading3.updateDayNote(accountId, '2026-09-15', 'Edited day note — persisted')
    equal(trading3.getDay(accountId, '2026-09-15').dayNote, 'Edited day note — persisted')
    equal(trading3.getDetail(trades.c.id).dayNote, 'Edited day note — persisted')
    equal(trading3.getDetail(trades.d.id).dayNote, 'Edited day note — persisted')
    equal(trading3.getDetail(trades.b.id).dayNote, SEED_DAY_NOTES['2026-09-12'])
    // A different account on the same date has its own (empty) day note.
    const other = db3.repositories.accounts.create({ displayName: 'Other', sourcePlatform: 'dev-fixture', sourceAccountId: 'other', currency: 'USD', timezone: null })
    equal(trading3.getDay(other.id, '2026-09-15').dayNote, '')
    db3.close()
    const reopened = Database.open(seedPath)
    try {
      equal(new TradingService(reopened).getDay(accountId, '2026-09-15').dayNote, 'Edited day note — persisted')
    } finally {
      reopened.close()
    }
  })
  check('notes are refused for unknown trades/accounts', () => {
    const db4 = Database.open(seedPath)
    try {
      const svc = new TradingService(db4)
      throws(() => svc.updateTradeNote('nope', 'x'), /Trade not found/)
      throws(() => svc.updateDayNote('nope', '2026-09-15', 'x'), /Account not found/)
    } finally {
      db4.close()
    }
  })

  // ---- analytical date vs timestamps -----------------------------------------------
  check('analytical date is the grouping key: a trade near UTC midnight stays on its own trading day', () => {
    const db5 = Database.open(h.newDbPath(), { clock: h.makeClock() })
    try {
      const account = db5.repositories.accounts.create({ displayName: 'NY', sourcePlatform: 'dev-fixture', sourceAccountId: 'ny', currency: 'USD', timezone: 'America/New_York' })
      // 2026-09-15 23:30 New York (EDT) == 2026-09-16 03:30 UTC.
      const opened = Date.UTC(2026, 8, 16, 3, 30, 0)
      db5.repositories.trades.createTrade({
        accountId: account.id,
        analyticalTradeDate: '2026-09-15',
        instrument: 'NQ',
        direction: 'SHORT',
        quantity: '1',
        openedAt: opened,
        closedAt: opened + 60_000,
        avgEntryPrice: '100',
        avgExitPrice: '99',
        grossPnl: '20',
        netPnl: '20',
        executions: [
          { executedAt: opened, side: 'SELL', quantity: '1', price: '100' },
          { executedAt: opened + 60_000, side: 'BUY', quantity: '1', price: '99' }
        ]
      })
      const svc = new TradingService(db5)
      equal(svc.getDay(account.id, '2026-09-15').trades.length, 1)
      equal(svc.getDay(account.id, '2026-09-16').trades.length, 0)
      const row = svc.list().trades[0] as TradeSummaryDto
      equal(row.tradeDate, '2026-09-15')
      equal(clockTime(row.openedAt, row.timezone), '23:30:00')
      equal(clockTime(row.openedAt, null), '03:30:00')
      equal(new Date(row.openedAt).toISOString().slice(0, 10), '2026-09-16')
      equal(row.commission, null, 'unreported cost is null, not zero')
      equal(row.strategy, null)
      equal(row.compliance, { pass: 0, fail: 0, na: 0, unreviewed: 0 })
    } finally {
      db5.close()
    }
  })

  // ---- IPC layer ------------------------------------------------------------------------
  const ipcDb = Database.open(seedPath, { clock: h.makeClock() })
  const handlers = createTradeHandlers({ getService: () => new TradingService(ipcDb), log: () => undefined })
  const call = (channel: keyof typeof handlers, payload?: unknown): IpcResult<unknown> => handlers[channel](payload)
  const okData = <T,>(result: IpcResult<unknown>): T => {
    if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
    return result.data as T
  }
  const failCode = (result: IpcResult<unknown>, code: string): void => {
    if (result.ok) throw new Error(`expected ${code}, got ok`)
    equal(result.error.code, code)
  }

  check('IPC: exactly the six named Trading channels, nothing generic', () => {
    equal(Object.keys(handlers).sort(), Object.values(TRADE_CHANNELS).sort())
    equal(Object.keys(handlers).length, 6)
  })
  check('IPC: list/getDetail/getDay return plain serializable data (no BigInt)', () => {
    const l = okData<TradeListDto>(call(TRADE_CHANNELS.list))
    equal(l.trades.length, 17)
    const detail = okData<TradeDetailDto>(call(TRADE_CHANNELS.getDetail, l.trades[0]?.id))
    equal(detail.executions.length, 2)
    // (Two accounts exist by now — the D check added one — so pick the dev account by name.)
    const dev = must(l.accounts.find((x) => x.displayName === 'Demo Account 50K'), 'dev account')
    const day = okData<DayDto>(call(TRADE_CHANNELS.getDay, { accountId: dev.id, date: '2026-09-15' }))
    equal(day.trades.length, 2)
    JSON.stringify([l, detail, day])
    const filtered = okData<TradeListDto>(call(TRADE_CHANNELS.list, { fromDate: '2026-09-15', toDate: '2026-09-16' }))
    equal(filtered.trades.length, 3)
  })
  check('IPC: malformed, oversized and unknown payloads become INVALID_INPUT, never exceptions', () => {
    failCode(call(TRADE_CHANNELS.getDetail, 42), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.getDetail, ''), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.getDay, { accountId: 'a', date: '2026-02-31' }), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.getDay, { accountId: 'a', date: 'yesterday' }), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.getDay, 'SELECT * FROM trades'), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.list, { fromDate: '15/09/2026' }), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.updateTradeNote, { tradeId: 't', body: 5 }), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.updateTradeNote, { tradeId: 't', body: 'x'.repeat(30_000) }), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.updateDayNote, { accountId: 'a', date: '2026-09-15' }), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.updateRuleEvaluation, { tradeId: 't', ruleId: 'r', state: 'Passed' }), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.updateRuleEvaluation, { tradeId: 't', ruleId: 'r', state: 'PASS' }), 'INVALID_INPUT')
    failCode(call(TRADE_CHANNELS.updateRuleEvaluation, null), 'INVALID_INPUT')
  })
  check('IPC: NOT_FOUND / RULE_VIOLATION codes carry through', () => {
    failCode(call(TRADE_CHANNELS.getDetail, 'no-such-trade'), 'NOT_FOUND')
    failCode(call(TRADE_CHANNELS.updateTradeNote, { tradeId: 'no-such-trade', body: 'x' }), 'NOT_FOUND')
    const l = okData<TradeListDto>(call(TRADE_CHANNELS.list))
    const detail = okData<TradeDetailDto>(call(TRADE_CHANNELS.getDetail, l.trades[0]?.id))
    const anyRule = must(detail.strategy?.groups[0]?.rules[0], 'rule')
    const otherTrade = must(l.trades.find((t) => t.strategy?.versionId !== detail.strategy?.versionId), 'trade on another version')
    failCode(
      call(TRADE_CHANNELS.updateRuleEvaluation, { tradeId: otherTrade.id, ruleId: anyRule.ruleId, state: 'Pass' }),
      'RULE_VIOLATION'
    )
  })
  check('IPC: writes go through validation and land in SQLite (note + rule state round trip)', () => {
    const l = okData<TradeListDto>(call(TRADE_CHANNELS.list))
    const t = must(l.trades[0], 'trade')
    equal(okData<{ body: string }>(call(TRADE_CHANNELS.updateTradeNote, { tradeId: t.id, body: 'via ipc' })).body, 'via ipc')
    equal(okData<TradeDetailDto>(call(TRADE_CHANNELS.getDetail, t.id)).tradeNote, 'via ipc')
    const rule = must(okData<TradeDetailDto>(call(TRADE_CHANNELS.getDetail, t.id)).strategy?.groups[0]?.rules[0], 'rule')
    const r = okData<RuleEvaluationResultDto>(call(TRADE_CHANNELS.updateRuleEvaluation, { tradeId: t.id, ruleId: rule.ruleId, state: 'Unreviewed' }))
    equal(r.compliance.unreviewed, 1)
    equal(summarizeCounts(r.compliance).reviewComplete, false)
  })
  check('J persistence unavailable: every Trading channel reports PERSISTENCE_UNAVAILABLE (no silent empty data)', () => {
    const down = createTradeHandlers({ getService: () => null, log: () => undefined })
    for (const channel of Object.values(TRADE_CHANNELS)) {
      const result = down[channel]({ tradeId: 'x', accountId: 'a', date: '2026-09-15', body: '', ruleId: 'r', state: 'Pass' })
      equal(result.ok, false, channel)
      if (result.ok) throw new Error('unreachable')
      equal(result.error.code, 'PERSISTENCE_UNAVAILABLE', channel)
    }
  })
  check('unexpected failures are logged and returned as a generic INTERNAL error (no internals leaked)', () => {
    let logged = 0
    const broken = { list: () => { throw new Error('sqlite secret path C:/x') } } as unknown as TradingService
    const bad = createTradeHandlers({ getService: () => broken, log: () => { logged += 1 } })
    const result = bad[TRADE_CHANNELS.list](undefined)
    failCode(result, 'INTERNAL')
    equal(/secret|sqlite/.test(JSON.stringify(result)), false, 'no leak')
    equal(logged, 1)
    // A ServiceError is a controlled outcome, not an internal error.
    const refusing = { list: () => { throw new ServiceError('CONFLICT', 'nope') } } as unknown as TradingService
    failCode(createTradeHandlers({ getService: () => refusing, log: () => undefined })[TRADE_CHANNELS.list](undefined), 'CONFLICT')
  })
  ipcDb.close()
}
