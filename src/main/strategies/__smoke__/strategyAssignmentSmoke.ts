/**
 * Strategy Assignment + Strategy list ordering smoke suite (Checkpoint 015B,
 * docs/STRATEGY_ASSIGNMENT.md). Development tooling only — not imported by the
 * application. Run with `npm run smoke:strategy-assignment`. Runs on the
 * Electron-embedded Node runtime against TEMPORARY databases only (never the
 * user's database) and covers:
 *   - one-time assignment of an EXACT published Strategy Version to an
 *     unassigned Trade: exact version id, UNREVIEWED initialization, one row
 *     per rule, transaction rollback, refusal of Strategy ids / Drafts /
 *     reassignment, archived + historical version behaviour, publishing a newer
 *     version later
 *   - evaluation through the existing updateRuleEvaluation path, compliance
 *     math, Review Incomplete
 *   - Weekly Review read model + achievements consuming the same persisted data
 *   - no historical Trade fact changes; active account untouched
 *   - Strategy list ordering: migration 006, deterministic default, move,
 *     restart, create / archive / restore / delete positions, uniqueness, and
 *     that ordering never creates a version or touches rules / trades
 *   - IPC handler validation for both new operations
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Database } from '../../persistence/database'
import { MIGRATIONS } from '../../persistence/migrations'
import type { NewTrade } from '../../persistence/repositories/trades'
import { StrategyService } from '../strategyService'
import { TradingService } from '../../trading/tradingService'
import { ReviewService } from '../../review/reviewService'
import { AccountService } from '../../accounts/accountService'
import { MemoryActiveAccountStore } from '../../accounts/activeAccountStore'
import { createTradeHandlers } from '../../ipc/tradeHandlers'
import { createStrategyHandlers } from '../../ipc/strategyHandlers'
import { STRATEGY_CHANNELS } from '../../../shared/ipc/strategies'
import type { StrategyDto } from '../../../shared/ipc/strategies'
import { TRADE_CHANNELS } from '../../../shared/ipc/trades'
import type { RuleStateDto, TradeDetailDto } from '../../../shared/ipc/trades'
import type { IpcResult } from '../../../shared/ipc/result'
import { EMPTY_REFLECTION, WEEKLY_SCORECARD_DIMENSIONS } from '../../../shared/ipc/reviews'
import { summarizeCounts } from '../../../shared/compliance'
import { computeAchievements, computeProcessMetrics, computeRuleReview } from '../../../renderer/src/lib/weeklyReview'

const outFile = process.env['SMOKE_OUT']
if (outFile !== undefined) writeFileSync(outFile, '')

let passed = 0
let failed = 0
function log(line: string): void {
  if (outFile !== undefined) appendFileSync(outFile, `${line}\n`)
  else console.log(line)
}
function check(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
function equal<T>(actual: T, expected: T, label = 'value'): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`)
}
function throws(fn: () => unknown, pattern: RegExp): void {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!pattern.test(message)) throw new Error(`threw "${message}", expected ${pattern}`)
    return
  }
  throw new Error(`expected an error matching ${pattern}, but nothing was thrown`)
}
function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} is missing`)
  return value
}
function failCode(result: IpcResult<unknown>, code: string): void {
  if (result.ok) throw new Error(`expected ${code}, got ok`)
  equal(result.error.code, code, 'error code')
}
function okData<T>(result: IpcResult<unknown>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.data as T
}

const workDir = mkdtempSync(join(tmpdir(), 'solid-skill-strategy-assignment-smoke-'))
let counter = 0
const newDbPath = (): string => join(workDir, `assign-${(counter += 1)}.db`)
function makeClock(start = 1_789_000_000_000): () => number {
  let t = start
  return () => (t += 1000)
}

const WEEK = '2026-09-13' // a canonical Sunday week start (src/shared/week.ts)

function trade(accountId: string, date: string, net: string, openedAt = Date.parse(`${date}T14:30:00Z`)): NewTrade {
  return {
    accountId,
    sourceTradeId: `src-${openedAt}`,
    sourcePositionId: `pos-${openedAt}`,
    analyticalTradeDate: date,
    instrument: 'SYMBOL-X',
    direction: 'SHORT',
    quantity: '2',
    openedAt,
    closedAt: openedAt + 90_000,
    avgEntryPrice: '101.25',
    avgExitPrice: '100.5',
    grossPnl: net,
    commission: '-1.5',
    fees: null,
    swap: '-0.25',
    netPnl: (Number(net) - 1.75).toString(),
    realizedR: '1.2',
    executions: [
      { executedAt: openedAt, side: 'SELL', quantity: '2', price: '101.25', commission: '-0.75', sourceExecutionId: `x-${openedAt}-a` },
      { executedAt: openedAt + 90_000, side: 'BUY', quantity: '2', price: '100.5', commission: '-0.75', sourceExecutionId: `x-${openedAt}-b` }
    ]
  }
}

interface World {
  db: Database
  path: string
  strategies: StrategyService
  trading: TradingService
  reviews: ReviewService
  accounts: AccountService
  accountA: string
  accountB: string
}

function openWorld(path = newDbPath()): World {
  const db = Database.open(path, { clock: makeClock() })
  const a = db.repositories.accounts.create({ displayName: 'Account A', sourcePlatform: 'dev-fixture', currency: 'USD' })
  const b = db.repositories.accounts.create({ displayName: 'Account B', sourcePlatform: 'MT5', sourceAccountId: 'acct-b', currency: 'USD' })
  return {
    db,
    path,
    strategies: new StrategyService(db),
    trading: new TradingService(db),
    reviews: new ReviewService(db),
    accounts: new AccountService(db, new MemoryActiveAccountStore()),
    accountA: a.id,
    accountB: b.id
  }
}

/** Creates and publishes a Strategy through the real service. User data only: generic names. */
function publishStrategy(svc: StrategyService, name: string, groups: { name: string; rules: string[] }[]): StrategyDto {
  let dto = svc.create({ name, description: '' })
  for (const group of groups) {
    dto = svc.editDraft(dto.id, { type: 'addGroup', name: group.name })
    const groupId = must(dto.draft?.groups.find((g) => g.name === group.name), group.name).id
    for (const rule of group.rules) {
      dto = svc.editDraft(dto.id, { type: 'addRule', groupId, name: rule, kind: 'Required', description: '' })
    }
  }
  return svc.publishDraft(dto.id)
}

/** Publishes the next version with one extra rule appended to the first group. */
function publishNext(svc: StrategyService, strategyId: string, extraRule: string): StrategyDto {
  let dto = svc.beginDraft(strategyId)
  const groupId = must(dto.draft?.groups[0], 'draft group').id
  dto = svc.editDraft(strategyId, { type: 'addRule', groupId, name: extraRule, kind: 'Optional', description: '' })
  return svc.publishDraft(strategyId)
}

function rawRows(path: string, sql: string, params: (string | number)[] = []): Record<string, unknown>[] {
  const raw = new DatabaseSync(path, { readOnly: true })
  try {
    return raw.prepare(sql).all(...params) as Record<string, unknown>[]
  } finally {
    raw.close()
  }
}
const stringify = (rows: unknown[]): string => JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))

/**
 * Every historical Trade fact of one Trade, serialized. strategy_version_id and
 * the row's updated_at are the ONLY trade columns assignment may change, so they
 * are excluded here and asserted separately.
 */
function tradeFacts(path: string, tradeId: string): string {
  return [
    stringify(
      rawRows(path, 'SELECT * FROM trades WHERE id = ?', [tradeId]).map((r) => {
        const { strategy_version_id: _v, updated_at: _u, ...facts } = r
        return facts
      })
    ),
    stringify(rawRows(path, 'SELECT * FROM executions WHERE trade_id = ? ORDER BY id', [tradeId])),
    stringify(rawRows(path, 'SELECT * FROM trade_notes WHERE trade_id = ?', [tradeId])),
    stringify(rawRows(path, 'SELECT * FROM day_notes ORDER BY account_id, trade_date')),
    stringify(rawRows(path, 'SELECT * FROM trade_media ORDER BY id'))
  ].join('\n---\n')
}

/** Strategy logic tables (versions, groups, rules), serialized. */
function strategyLogic(path: string): string {
  return ['strategy_versions', 'rule_groups', 'rules']
    .map((t) => stringify(rawRows(path, `SELECT * FROM ${t} ORDER BY id`)))
    .join('\n---\n')
}

// ===========================================================================
// A. Assignment
// ===========================================================================
{
  const w = openWorld()
  const { db, strategies, trading } = w
  try {
    // Generic user data. Two groups, three rules; then v2 adds a fourth.
    const alpha1 = publishStrategy(strategies, 'Strategy Alpha', [
      { name: 'Group A', rules: ['Rule A', 'Rule B'] },
      { name: 'Group B', rules: ['Rule C'] }
    ])
    const alpha = publishNext(strategies, alpha1.id, 'Rule D')
    const v1 = must(alpha.versions[0], 'v1')
    const v2 = must(alpha.versions[1], 'v2')
    const t1 = db.repositories.trades.createTrade(trade(w.accountA, '2026-09-14', '40'))
    const t2 = db.repositories.trades.createTrade(trade(w.accountA, '2026-09-15', '-20'))
    const t3 = db.repositories.trades.createTrade(trade(w.accountA, '2026-09-16', '10'))
    db.repositories.notes.upsertTradeNote(t1.id, 'kept exactly  ')
    db.repositories.notes.upsertDayNote(w.accountA, '2026-09-14', 'day note')
    db.repositories.media.createForTrade({
      tradeId: t1.id,
      accountId: w.accountA,
      managedPath: 'trades/x.png',
      format: 'PNG',
      timeframe: 'M5',
      stage: 'ENTRY',
      caption: null,
      isFeatured: true
    })
    w.accounts.setActive(w.accountB)
    const factsBefore = tradeFacts(w.path, t1.id)

    check('1/2/10 unassigned Trade can be assigned the CURRENT published version; the exact version id is stored', () => {
      equal(must(db.repositories.trades.getById(t1.id), 't1').strategyVersionId, null, 'starts unassigned')
      const detail = trading.assignStrategyVersion(t1.id, v2.id)
      equal(detail.trade.strategy?.versionId, v2.id, 'dto version id')
      equal(detail.trade.strategy?.versionNumber, 2, 'dto version number')
      equal(detail.strategy?.strategyName, 'Strategy Alpha')
      equal(must(db.repositories.trades.getById(t1.id), 't1').strategyVersionId, v2.id, 'persisted exact version id')
    })

    check('4/5/6 every rule of the version gets exactly one UNREVIEWED evaluation', () => {
      const rows = rawRows(w.path, 'SELECT rule_id, state, evaluated_at, strategy_version_id FROM trade_rule_evaluations WHERE trade_id = ?', [t1.id])
      const rules = db.repositories.strategyVersions.listRules(v2.id).map((r) => r.id).sort()
      equal(rows.length, 4, 'one row per rule of v2')
      equal(rows.map((r) => String(r['rule_id'])).sort(), rules, 'exactly the rules of v2')
      equal(new Set(rows.map((r) => r['rule_id'])).size, rows.length, 'no duplicates')
      equal(rows.every((r) => r['state'] === 'UNREVIEWED' && r['evaluated_at'] === null), true, 'all UNREVIEWED, never PASS/FAIL/N/A')
      equal(rows.every((r) => r['strategy_version_id'] === v2.id), true, 'bound to v2')
      const detail = trading.getDetail(t1.id)
      equal(detail.strategy?.groups.map((g) => [g.name, g.rules.map((r) => `${r.name}:${r.state}`)]), [
        ['Group A', ['Rule A:Unreviewed', 'Rule B:Unreviewed', 'Rule D:Unreviewed']],
        ['Group B', ['Rule C:Unreviewed']]
      ])
    })

    check('11 a HISTORICAL published version is selectable and stored exactly (no reinterpretation via today\'s v2)', () => {
      const detail = trading.assignStrategyVersion(t2.id, v1.id)
      equal(detail.trade.strategy?.versionNumber, 1)
      equal(rawRows(w.path, 'SELECT COUNT(*) AS n FROM trade_rule_evaluations WHERE trade_id = ?', [t2.id])[0]?.['n'], 3, 'v1 has 3 rules')
      equal(detail.strategy?.groups.flatMap((g) => g.rules.map((r) => r.name)), ['Rule A', 'Rule B', 'Rule C'], 'v1 wording, no Rule D')
    })

    check('3 a Strategy id alone is refused (NOT_FOUND); nothing is written', () => {
      throws(() => trading.assignStrategyVersion(t3.id, alpha.id), /Strategy version not found/)
      equal(must(db.repositories.trades.getById(t3.id), 't3').strategyVersionId, null)
      equal(rawRows(w.path, 'SELECT COUNT(*) AS n FROM trade_rule_evaluations WHERE trade_id = ?', [t3.id])[0]?.['n'], 0)
    })

    check('a Draft version is refused (a Draft is never evaluated)', () => {
      const withDraft = strategies.beginDraft(alpha.id)
      const draftId = must(withDraft.draft, 'draft').id
      throws(() => trading.assignStrategyVersion(t3.id, draftId), /Only a published strategy version/)
      strategies.discardDraft(alpha.id)
      equal(must(db.repositories.trades.getById(t3.id), 't3').strategyVersionId, null)
    })

    check('8 an already-assigned Trade cannot be reassigned (service CONFLICT + schema trigger)', () => {
      throws(() => trading.assignStrategyVersion(t1.id, v1.id), /already associated/)
      throws(() => trading.assignStrategyVersion(t1.id, v2.id), /already associated/)
      throws(() => db.repositories.trades.associateStrategyVersion(t1.id, v1.id), /already associated/)
      equal(must(db.repositories.trades.getById(t1.id), 't1').strategyVersionId, v2.id, 'still v2')
      equal(rawRows(w.path, 'SELECT COUNT(*) AS n FROM trade_rule_evaluations WHERE trade_id = ?', [t1.id])[0]?.['n'], 4, 'no extra rows')
    })

    check('12/13 the chosen version is kept even if a newer version is published before/after confirming', () => {
      // A newer version (v3) appears between "user selected v2" and "assign".
      const alpha3 = publishNext(strategies, alpha.id, 'Rule E')
      const v3 = must(alpha3.versions[2], 'v3')
      const detail = trading.assignStrategyVersion(t3.id, v2.id)
      equal(detail.trade.strategy?.versionId, v2.id, 'not silently upgraded to v3')
      // ...and publishing v3 never moves Trades already assigned to v2 / v1.
      equal(must(db.repositories.trades.getById(t1.id), 't1').strategyVersionId, v2.id)
      equal(must(db.repositories.trades.getById(t2.id), 't2').strategyVersionId, v1.id)
      equal(
        rawRows(w.path, 'SELECT COUNT(*) AS n FROM trade_rule_evaluations WHERE strategy_version_id = ?', [v3.id])[0]?.['n'],
        0,
        'no evaluation was created against v3'
      )
    })

    // --- evaluation through the EXISTING updateRuleEvaluation path ---------
    const rulesOf = (tradeId: string): { id: string; name: string }[] =>
      must(trading.getDetail(tradeId).strategy, 'strategy').groups.flatMap((g) => g.rules.map((r) => ({ id: r.ruleId, name: r.name })))
    const set = (tradeId: string, ruleName: string, state: RuleStateDto) =>
      trading.updateRuleEvaluation(tradeId, must(rulesOf(tradeId).find((r) => r.name === ruleName), ruleName).id, state)

    check('14/15/16/17 PASS / FAIL / N/A / UNREVIEWED all persist through updateRuleEvaluation', () => {
      equal(set(t1.id, 'Rule A', 'Pass').state, 'Pass')
      equal(set(t1.id, 'Rule B', 'Fail').state, 'Fail')
      equal(set(t1.id, 'Rule C', 'N/A').state, 'N/A')
      equal(set(t1.id, 'Rule D', 'Pass').state, 'Pass')
      equal(set(t1.id, 'Rule D', 'Unreviewed').state, 'Unreviewed')
      const byName = Object.fromEntries(
        must(trading.getDetail(t1.id).strategy, 's').groups.flatMap((g) => g.rules.map((r) => [r.name, r.state]))
      )
      equal(byName, { 'Rule A': 'Pass', 'Rule B': 'Fail', 'Rule D': 'Unreviewed', 'Rule C': 'N/A' })
      const d = rawRows(w.path, `SELECT evaluated_at FROM trade_rule_evaluations WHERE trade_id = ? AND state = 'UNREVIEWED'`, [t1.id])
      equal(d.every((r) => r['evaluated_at'] === null), true, 'UNREVIEWED has no evaluated_at')
    })

    check('18/19 compliance = PASS/(PASS+FAIL); N/A and UNREVIEWED excluded; Review Incomplete while any UNREVIEWED', () => {
      const s1 = summarizeCounts(trading.getDetail(t1.id).trade.compliance)
      equal([s1.pass, s1.fail, s1.na, s1.unreviewed], [1, 1, 1, 1])
      equal(s1.percent, 50, '1 / (1 + 1)')
      equal(s1.reviewComplete, false, 'Rule D still UNREVIEWED')
      set(t1.id, 'Rule D', 'Pass')
      const s2 = summarizeCounts(trading.getDetail(t1.id).trade.compliance)
      equal([s2.pass, s2.fail, s2.na, s2.unreviewed], [2, 1, 1, 0])
      equal(s2.percent, 67, '2 / 3, rounded to a whole percent (shared/compliance.ts)')
      equal(s2.evaluated, 3, 'N/A excluded from the denominator')
      equal(s2.reviewComplete, true)
    })

    check('P&L never changes compliance: the losing Trade with the same judgments has the same percentage', () => {
      set(t3.id, 'Rule A', 'Pass')
      set(t3.id, 'Rule B', 'Fail')
      set(t3.id, 'Rule C', 'N/A')
      set(t3.id, 'Rule D', 'Pass')
      equal(summarizeCounts(trading.getDetail(t3.id).trade.compliance).percent, summarizeCounts(trading.getDetail(t1.id).trade.compliance).percent)
    })

    check('20 Weekly Review reads the assignment + evaluations from persisted data (no special write)', () => {
      const before = stringify(rawRows(w.path, 'SELECT * FROM weekly_reviews')) + stringify(rawRows(w.path, 'SELECT * FROM weekly_scorecard_entries'))
      const week = w.reviews.getWeek(w.accountA, WEEK)
      const p = computeProcessMetrics(week.trades)
      equal([p.trades, p.withStrategy, p.noStrategy], [3, 3, 0])
      equal(p.versions, 2, 'v1 and v2 are distinct versions')
      equal(week.ruleResults.filter((r) => r.tradeId === t1.id).length, 4)
      const review = computeRuleReview(week.ruleResults, week.trades)
      equal(review.map((v) => v.versionNumber).sort(), [1, 2], 'grouped by exact version')
      const after = stringify(rawRows(w.path, 'SELECT * FROM weekly_reviews')) + stringify(rawRows(w.path, 'SELECT * FROM weekly_scorecard_entries'))
      equal(after, before, 'reading the week wrote nothing')
    })

    check('21 achievements consume the same canonical data (All Trades Reviewed / No FAIL / Clean Process)', () => {
      const achieve = () => {
        const week = w.reviews.getWeek(w.accountA, WEEK)
        const scorecard = Object.fromEntries(WEEKLY_SCORECARD_DIMENSIONS.map((d) => [d, { score: null }])) as Record<
          (typeof WEEKLY_SCORECARD_DIMENSIONS)[number],
          { score: number | null }
        >
        return Object.fromEntries(
          computeAchievements({ weekStart: WEEK, trades: week.trades, reflection: EMPTY_REFLECTION, scorecard, authoredWeeks: [] }).map((a) => [a.id, a.earned])
        )
      }
      let a = achieve()
      equal([a['tradesReviewed'], a['noRuleFails'], a['cleanProcess']], [false, false, false], 't2 still UNREVIEWED and FAILs recorded')
      for (const r of rulesOf(t2.id)) trading.updateRuleEvaluation(t2.id, r.id, 'Pass')
      a = achieve()
      equal(a['tradesReviewed'], true, 'every Trade fully judged')
      equal(a['noRuleFails'], false, 'FAILs recorded on t1/t3')
      set(t1.id, 'Rule B', 'Pass')
      set(t3.id, 'Rule B', 'Pass')
      a = achieve()
      equal([a['tradesReviewed'], a['noRuleFails'], a['cleanProcess']], [true, true, true])
    })

    check('22 no historical Trade fact changed (trade columns, executions, notes, day notes, media)', () => {
      equal(tradeFacts(w.path, t1.id), factsBefore)
      const row = must(rawRows(w.path, 'SELECT direction, instrument, quantity, net_pnl, commission, swap FROM trades WHERE id = ?', [t1.id])[0], 'row')
      equal(row['direction'], 'SHORT')
      equal(trading.getDetail(t1.id).tradeNote, 'kept exactly  ')
      equal(trading.getDetail(t1.id).executions.length, 2)
    })

    check('23 assignment never changes the active account', () => {
      equal(w.accounts.list().activeAccountId, w.accountB, 'still B after assigning Trades of A')
      const tb = db.repositories.trades.createTrade(trade(w.accountB, '2026-09-17', '5'))
      trading.assignStrategyVersion(tb.id, v2.id)
      equal(w.accounts.list().activeAccountId, w.accountB)
    })
  } finally {
    db.close()
  }
}

check('7 transaction rolls back if evaluation creation fails: Trade stays unassigned, no evaluation rows', () => {
  const w = openWorld()
  const s = publishStrategy(w.strategies, 'Strategy Beta', [{ name: 'Group A', rules: ['Rule A', 'Rule B'] }])
  const t = w.db.repositories.trades.createTrade(trade(w.accountA, '2026-09-14', '1'))
  const before = tradeFacts(w.path, t.id)
  w.db.close()
  // Inject a failure at the SECOND evaluation insert (after the Trade row was already updated).
  const raw = new DatabaseSync(w.path)
  raw.exec(`CREATE TRIGGER smoke_fail_second_eval BEFORE INSERT ON trade_rule_evaluations
            WHEN (SELECT COUNT(*) FROM trade_rule_evaluations WHERE trade_id = NEW.trade_id) >= 1
            BEGIN SELECT RAISE(ABORT, 'injected evaluation failure'); END;`)
  raw.close()
  const db = Database.open(w.path)
  try {
    throws(() => new TradingService(db).assignStrategyVersion(t.id, must(s.versions[0], 'v1').id), /injected evaluation failure/)
    equal(must(db.repositories.trades.getById(t.id), 't').strategyVersionId, null, 'trade not assigned')
    equal(rawRows(w.path, 'SELECT COUNT(*) AS n FROM trade_rule_evaluations')[0]?.['n'], 0, 'no evaluation rows')
    equal(tradeFacts(w.path, t.id), before, 'facts unchanged')
  } finally {
    db.close()
  }
})

check('9 archived Strategy: its published versions stay assignable (documented decision); assignment does not restore it', () => {
  const w = openWorld()
  try {
    const s = publishStrategy(w.strategies, 'Strategy Gamma', [{ name: 'Group A', rules: ['Rule A'] }])
    w.strategies.archive(s.id)
    const t = w.db.repositories.trades.createTrade(trade(w.accountA, '2026-09-14', '1'))
    const detail = w.trading.assignStrategyVersion(t.id, must(s.versions[0], 'v1').id)
    equal(detail.trade.strategy?.strategyName, 'Strategy Gamma')
    equal(must(w.db.repositories.strategies.getById(s.id), 's').status, 'ARCHIVED', 'still archived')
  } finally {
    w.db.close()
  }
})

check('IPC: assignStrategyVersion validates input and maps refusals to codes', () => {
  const w = openWorld()
  try {
    const call = createTradeHandlers({ getService: () => w.trading, log: () => {} })
    const s = publishStrategy(w.strategies, 'Strategy Delta', [{ name: 'Group A', rules: ['Rule A'] }])
    const t = w.db.repositories.trades.createTrade(trade(w.accountA, '2026-09-14', '1'))
    const C = TRADE_CHANNELS.assignStrategyVersion
    failCode(call[C](null), 'INVALID_INPUT')
    failCode(call[C]({ tradeId: t.id }), 'INVALID_INPUT')
    failCode(call[C]({ tradeId: t.id, strategyVersionId: '' }), 'INVALID_INPUT')
    failCode(call[C]({ tradeId: 'missing', strategyVersionId: must(s.versions[0], 'v1').id }), 'NOT_FOUND')
    failCode(call[C]({ tradeId: t.id, strategyVersionId: s.id }), 'NOT_FOUND')
    const detail = okData<TradeDetailDto>(call[C]({ tradeId: t.id, strategyVersionId: must(s.versions[0], 'v1').id }))
    equal(detail.strategy?.groups[0]?.rules[0]?.state, 'Unreviewed')
    failCode(call[C]({ tradeId: t.id, strategyVersionId: must(s.versions[0], 'v1').id }), 'CONFLICT')
    const unavailable = createTradeHandlers({ getService: () => null, log: () => {} })
    failCode(unavailable[C]({ tradeId: t.id, strategyVersionId: 'x' }), 'PERSISTENCE_UNAVAILABLE')
  } finally {
    w.db.close()
  }
})

// ===========================================================================
// B. Strategy list ordering
// ===========================================================================
const names = (list: StrategyDto[], status: 'Active' | 'Archived' = 'Active'): string[] =>
  list.filter((s) => s.status === status).sort((a, b) => a.position - b.position).map((s) => s.name)
const positions = (list: StrategyDto[], status: 'Active' | 'Archived' = 'Active'): number[] =>
  list.filter((s) => s.status === status).map((s) => s.position).sort((a, b) => a - b)
const duplicates = (path: string): number =>
  rawRows(path, 'SELECT COUNT(*) AS n FROM (SELECT status, display_position FROM strategies GROUP BY 1, 2 HAVING COUNT(*) > 1)')[0]?.['n'] as number

check('migration 006 upgrades an existing 001–005 database: dense positions in previous order, nothing else touched', () => {
  const path = newDbPath()
  // The repositories now read display_position, which 001–005 do not have: seed through raw SQL only.
  Database.open(path, { migrations: MIGRATIONS.slice(0, 5) }).close()
  const raw = new DatabaseSync(path)
  const ins = raw.prepare(
    `INSERT INTO strategies (id, name, description, status, archived_at, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?)`
  )
  ins.run('s-3', 'Third', 'ACTIVE', null, 3000, 3000)
  ins.run('s-1', 'First', 'ACTIVE', null, 1000, 1000)
  ins.run('s-2', 'Second', 'ARCHIVED', 2500, 2000, 2000)
  ins.run('s-4', 'Fourth', 'ACTIVE', null, 4000, 4000)
  raw.close()
  const before = stringify(rawRows(path, 'SELECT id, name, description, status, archived_at, created_at, updated_at FROM strategies ORDER BY id'))
  const upgraded = Database.open(path)
  try {
    equal(upgraded.health.migrationsAppliedThisOpen, [6])
    equal(upgraded.listAppliedMigrations().map((m) => m.name).slice(-1), ['strategy_display_order'])
    const list = new StrategyService(upgraded).list()
    equal(names(list), ['First', 'Third', 'Fourth'], 'previous created_at order kept')
    equal(positions(list), [0, 1, 2])
    equal(names(list, 'Archived'), ['Second'])
    equal(positions(list, 'Archived'), [0])
  } finally {
    upgraded.close()
  }
  equal(stringify(rawRows(path, 'SELECT id, name, description, status, archived_at, created_at, updated_at FROM strategies ORDER BY id')), before, 'no other column changed')
})

{
  const path = newDbPath()
  let w = openWorld(path)
  try {
    const alpha = publishStrategy(w.strategies, 'Strategy Alpha', [{ name: 'Group A', rules: ['Rule A', 'Rule B'] }])
    publishStrategy(w.strategies, 'Strategy Beta', [{ name: 'Group A', rules: ['Rule A'] }])
    publishStrategy(w.strategies, 'Strategy Gamma', [{ name: 'Group A', rules: ['Rule A'] }])
    const t = w.db.repositories.trades.createTrade(trade(w.accountA, '2026-09-14', '1'))
    w.trading.assignStrategyVersion(t.id, must(alpha.versions[0], 'v1').id)
    w.trading.updateRuleEvaluation(t.id, must(w.trading.getDetail(t.id).strategy?.groups[0]?.rules[0], 'rule').ruleId, 'Pass')

    check('24 default ordering is deterministic: creation order, dense 0..n-1', () => {
      const list = w.strategies.list()
      equal(names(list), ['Strategy Alpha', 'Strategy Beta', 'Strategy Gamma'])
      equal(positions(list), [0, 1, 2])
    })

    const logicBefore = strategyLogic(path)
    const evalsBefore = stringify(rawRows(path, 'SELECT * FROM trade_rule_evaluations ORDER BY id'))
    const tradeBefore = stringify(rawRows(path, 'SELECT * FROM trades ORDER BY id'))

    check('25/34/35 reorder Active strategies; Move up / Move down', () => {
      const gamma = must(w.strategies.list().find((s) => s.name === 'Strategy Gamma'), 'gamma')
      equal(names(w.strategies.move({ strategyId: gamma.id, toIndex: 0 })), ['Strategy Gamma', 'Strategy Alpha', 'Strategy Beta'], 'drag to top')
      const alphaNow = must(w.strategies.list().find((s) => s.name === 'Strategy Alpha'), 'alpha')
      equal(names(w.strategies.move({ strategyId: alphaNow.id, toIndex: 0 })), ['Strategy Alpha', 'Strategy Gamma', 'Strategy Beta'], 'move up')
      const gammaNow = must(w.strategies.list().find((s) => s.name === 'Strategy Gamma'), 'gamma')
      equal(names(w.strategies.move({ strategyId: gammaNow.id, toIndex: 2 })), ['Strategy Alpha', 'Strategy Beta', 'Strategy Gamma'], 'move down')
      const beta = must(w.strategies.list().find((s) => s.name === 'Strategy Beta'), 'beta')
      equal(names(w.strategies.move({ strategyId: beta.id, toIndex: 0 })), ['Strategy Beta', 'Strategy Alpha', 'Strategy Gamma'])
      equal(positions(w.strategies.list()), [0, 1, 2])
    })

    check('36/37 top cannot move higher, bottom cannot move lower (refused, order unchanged)', () => {
      const list = w.strategies.list()
      const top = must(list.find((s) => s.position === 0), 'top')
      const bottom = must(list.find((s) => s.position === 2), 'bottom')
      throws(() => w.strategies.move({ strategyId: top.id, toIndex: -1 }), /beyond the ends/)
      throws(() => w.strategies.move({ strategyId: bottom.id, toIndex: 3 }), /beyond the ends/)
      equal(names(w.strategies.list()), ['Strategy Beta', 'Strategy Alpha', 'Strategy Gamma'])
    })

    check('27/28/29 reordering creates no version or draft, changes no rule, trade or evaluation', () => {
      equal(strategyLogic(path), logicBefore, 'versions / groups / rules identical')
      equal(w.strategies.list().every((s) => s.draft === null), true, 'no draft created')
      equal(stringify(rawRows(path, 'SELECT * FROM trade_rule_evaluations ORDER BY id')), evalsBefore)
      equal(stringify(rawRows(path, 'SELECT * FROM trades ORDER BY id')), tradeBefore)
      equal(w.strategies.list().map((s) => s.versions.length), [1, 1, 1], 'each still has exactly v1')
    })

    check('30 Create Strategy lands at the end of Active', () => {
      w.strategies.create({ name: 'Strategy Delta', description: '' })
      equal(names(w.strategies.list()), ['Strategy Beta', 'Strategy Alpha', 'Strategy Gamma', 'Strategy Delta'])
      equal(positions(w.strategies.list()), [0, 1, 2, 3])
    })

    check('31 Archive moves to end of Archived and keeps Active dense and in order', () => {
      const alphaNow = must(w.strategies.list().find((s) => s.name === 'Strategy Alpha'), 'alpha')
      w.strategies.archive(alphaNow.id)
      const beta = must(w.strategies.list().find((s) => s.name === 'Strategy Beta'), 'beta')
      w.strategies.archive(beta.id)
      const list = w.strategies.list()
      equal(names(list), ['Strategy Gamma', 'Strategy Delta'])
      equal(positions(list), [0, 1])
      equal(names(list, 'Archived'), ['Strategy Alpha', 'Strategy Beta'], 'archive order = order of archiving')
      equal(positions(list, 'Archived'), [0, 1])
    })

    check('reordering stays within a section (Archived reorder does not restore)', () => {
      const beta = must(w.strategies.list().find((s) => s.name === 'Strategy Beta'), 'beta')
      const list = w.strategies.move({ strategyId: beta.id, toIndex: 0 })
      equal(names(list, 'Archived'), ['Strategy Beta', 'Strategy Alpha'])
      equal(names(list), ['Strategy Gamma', 'Strategy Delta'], 'Active untouched')
      equal(must(list.find((s) => s.id === beta.id), 'beta').status, 'Archived', 'still archived')
      throws(() => w.strategies.move({ strategyId: beta.id, toIndex: 2 }), /beyond the ends/)
    })

    check('32 Restore puts the strategy at the end of Active; Archived stays dense', () => {
      const alphaNow = must(w.strategies.list().find((s) => s.name === 'Strategy Alpha'), 'alpha')
      w.strategies.restore(alphaNow.id)
      const list = w.strategies.list()
      equal(names(list), ['Strategy Gamma', 'Strategy Delta', 'Strategy Alpha'])
      equal(positions(list), [0, 1, 2])
      equal(names(list, 'Archived'), ['Strategy Beta'])
      equal(positions(list, 'Archived'), [0])
    })

    check('deleting a never-published strategy compacts Active', () => {
      const delta = must(w.strategies.list().find((s) => s.name === 'Strategy Delta'), 'delta')
      w.strategies.deleteUnpublished(delta.id)
      equal(names(w.strategies.list()), ['Strategy Gamma', 'Strategy Alpha'])
      equal(positions(w.strategies.list()), [0, 1])
    })

    check('33 no duplicate positions; the database itself refuses one', () => {
      equal(duplicates(path), 0)
      const [first, second] = w.strategies.list().filter((s) => s.status === 'Active')
      w.db.close()
      const raw = new DatabaseSync(path)
      try {
        throws(
          () => raw.prepare('UPDATE strategies SET display_position = ? WHERE id = ?').run(must(first, 'first').position, must(second, 'second').id),
          /UNIQUE constraint failed/
        )
      } finally {
        raw.close()
      }
      w.db = Database.open(path)
      w.strategies = new StrategyService(w.db)
    })

    check('26 manual order survives restart', () => {
      const expected = names(w.strategies.list())
      w.db.close()
      const reopened = Database.open(path)
      try {
        equal(reopened.health.migrationsAppliedThisOpen, [])
        equal(names(new StrategyService(reopened).list()), expected)
        equal(names(new StrategyService(reopened).list(), 'Archived'), ['Strategy Beta'])
      } finally {
        reopened.close()
      }
      w.db = Database.open(path)
      w.strategies = new StrategyService(w.db)
    })

    check('IPC: strategies:move validates input and maps refusals to codes', () => {
      const call = createStrategyHandlers({ getService: () => w.strategies, log: () => {} })
      const C = STRATEGY_CHANNELS.move
      const top = must(w.strategies.list().find((s) => s.status === 'Active' && s.position === 0), 'top')
      failCode(call[C](null), 'INVALID_INPUT')
      failCode(call[C]({ strategyId: top.id }), 'INVALID_INPUT')
      failCode(call[C]({ strategyId: top.id, toIndex: -1 }), 'INVALID_INPUT')
      failCode(call[C]({ strategyId: top.id, toIndex: 1.5 }), 'INVALID_INPUT')
      failCode(call[C]({ strategyId: top.id, toIndex: '1' }), 'INVALID_INPUT')
      failCode(call[C]({ strategyId: 'missing', toIndex: 0 }), 'NOT_FOUND')
      failCode(call[C]({ strategyId: top.id, toIndex: 9 }), 'RULE_VIOLATION')
      const list = okData<StrategyDto[]>(call[C]({ strategyId: top.id, toIndex: 1 }))
      equal(names(list), ['Strategy Alpha', 'Strategy Gamma'])
    })

    check('ordering fuzz: 200 random moves / archives / restores keep every section dense and unique', () => {
      let seed = 7
      const rand = (n: number): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed % n
      }
      for (let i = 0; i < 3; i += 1) publishStrategy(w.strategies, `Fuzz ${i}`, [{ name: 'Group A', rules: ['Rule A'] }])
      for (let i = 0; i < 200; i += 1) {
        const list = w.strategies.list()
        const pick = must(list[rand(list.length)], 'pick')
        const op = rand(4)
        if (op === 0 && pick.status === 'Active' && pick.draft === null) w.strategies.archive(pick.id)
        else if (op === 1 && pick.status === 'Archived') w.strategies.restore(pick.id)
        else {
          const size = list.filter((s) => s.status === pick.status).length
          w.strategies.move({ strategyId: pick.id, toIndex: rand(size) })
        }
      }
      const list = w.strategies.list()
      for (const status of ['Active', 'Archived'] as const) {
        const ps = positions(list, status)
        equal(ps, ps.map((_, i) => i), `${status} dense`)
      }
      equal(duplicates(path), 0)
      equal(strategyLogic(path).length > 0, true)
    })
  } finally {
    w.db.close()
  }
}

rmSync(workDir, { recursive: true, force: true })
log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
