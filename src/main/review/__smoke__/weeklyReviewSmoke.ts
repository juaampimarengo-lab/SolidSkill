/**
 * Weekly Review smoke suite (Checkpoint 015, docs/WEEKLY_REVIEW.md). Development
 * tooling only — not imported by the application. Run with
 * `npm run smoke:weekly-review`. Runs on the Electron-embedded Node runtime
 * against TEMPORARY databases (never the user's database) and covers:
 *   - deterministic week identity (src/shared/week.ts)
 *   - migration 004 (applies once, on top of an existing 001–003 database)
 *   - ReviewService facts: account scoping, week boundaries, exact Strategy
 *     Version rule wording, Day Note / Chart Evidence indicators, media reuse
 *   - the renderer's pure derivation (lib/weeklyReview.ts): outcome, process,
 *     compliance math, rule tallies, daily breakdown, and the edge cases
 *     (empty / one-trade / all-loss / all-win / break-even / NULL R /
 *     missing evaluations)
 *   - authored reflection persistence: exact text, partial saves, restart,
 *     account isolation, forecast timestamp, identity immutability
 *   - IPC handler validation
 *   - no historical Trade / execution / evaluation / note / media fact changes
 *   - Weekly Scorecard (migration 005): persistence, partial saves, isolation
 *     from the reflection, account isolation, restart, validation
 *   - progress bars (Process Compliance / Review Completion) and achievements:
 *     empty / partial / complete states, purity (inputs never mutated)
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Database } from '../../persistence/database'
import { MIGRATIONS } from '../../persistence/migrations'
import type { NewTrade } from '../../persistence/repositories/trades'
import type { EvaluationState } from '../../persistence/types'
import { seedDevelopmentStrategies } from '../../strategies/devSeed'
import { ReviewService } from '../reviewService'
import { createReviewHandlers } from '../../ipc/reviewHandlers'
import { REVIEW_CHANNELS } from '../../../shared/ipc/reviews'
import type { WeeklyReflectionDto, WeeklyReviewDto, WeeklyScorecardDimension, WeeklyScorecardDto } from '../../../shared/ipc/reviews'
import { WEEKLY_REFLECTION_FIELDS, WEEKLY_SCORECARD_DIMENSIONS, EMPTY_REFLECTION } from '../../../shared/ipc/reviews'
import type { IpcResult } from '../../../shared/ipc/result'
import type { TradeSummaryDto } from '../../../shared/ipc/trades'
import { addDays, isWeekStart, weekDates, weekEndOf, weekStartOf, weekdayOf, WEEK_START_DAY } from '../../../shared/week'
import {
  ACHIEVEMENT_IDS,
  CONSISTENT_REVIEWER_WEEKS,
  computeAchievements,
  computeDailyBreakdown,
  computeOutcomeMetrics,
  computeProcessMetrics,
  computeRuleReview,
  computeWeekProgress,
  ruleViolations,
  type AchievementInput
} from '../../../renderer/src/lib/weeklyReview'
import { divideDecimal } from '../../../renderer/src/lib/decimal'

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

const workDir = mkdtempSync(join(tmpdir(), 'solid-skill-weekly-review-smoke-'))
let counter = 0
const newDbPath = (): string => join(workDir, `weekly-${(counter += 1)}.db`)
function makeClock(start = 1_789_000_000_000): () => number {
  let t = start
  return () => (t += 1000)
}

function trade(
  accountId: string,
  date: string,
  net: string | null,
  options: { direction?: 'LONG' | 'SHORT'; r?: string | null; openedAt?: number } = {}
): NewTrade {
  const openedAt = options.openedAt ?? Date.parse(`${date}T14:30:00Z`)
  return {
    accountId,
    analyticalTradeDate: date,
    instrument: 'SYMBOL-X',
    direction: options.direction ?? 'LONG',
    quantity: '1',
    openedAt,
    closedAt: openedAt + 60_000,
    avgEntryPrice: '100',
    avgExitPrice: '101',
    netPnl: net,
    realizedR: options.r ?? null,
    executions: [
      { executedAt: openedAt, side: options.direction === 'SHORT' ? 'SELL' : 'BUY', quantity: '1', price: '100' },
      { executedAt: openedAt + 60_000, side: options.direction === 'SHORT' ? 'BUY' : 'SELL', quantity: '1', price: '101' }
    ]
  }
}

/** Every historical fact table, serialized — used to prove Weekly Review never writes to them. */
function factsDigest(path: string): string {
  const raw = new DatabaseSync(path, { readOnly: true })
  try {
    return ['trades', 'executions', 'trade_rule_evaluations', 'trade_notes', 'day_notes', 'trade_media', 'strategy_versions', 'rules']
      .map((t) =>
        raw
          .prepare(`SELECT * FROM ${t} ORDER BY 1`)
          .all()
          .map((r) => JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
          .join('\n')
      )
      .join('\n---\n')
  } finally {
    raw.close()
  }
}

// ===========================================================================
// 1. Week identity
// ===========================================================================
check('week: explicit Sunday start, independent of locale', () => {
  equal(WEEK_START_DAY, 0)
  equal(weekdayOf('2026-09-13'), 0, 'Sep 13 2026 is a Sunday')
  equal(weekdayOf('2026-09-19'), 6, 'Sep 19 2026 is a Saturday')
})
check('week: boundaries are deterministic (Sun..Sat)', () => {
  for (const d of ['2026-09-13', '2026-09-14', '2026-09-16', '2026-09-19']) equal(weekStartOf(d), '2026-09-13', d)
  equal(weekStartOf('2026-09-12'), '2026-09-06', 'Saturday belongs to the previous week')
  equal(weekStartOf('2026-09-20'), '2026-09-20', 'Sunday starts a new week')
  equal(weekEndOf('2026-09-13'), '2026-09-19')
  equal(weekDates('2026-09-13'), ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'])
})
check('week: year / leap-year boundaries', () => {
  equal(weekStartOf('2026-01-01'), '2025-12-28')
  equal(weekDates('2025-12-28')[6], '2026-01-03')
  equal(weekStartOf('2028-02-29'), '2028-02-27')
  equal(addDays('2028-02-28', 1), '2028-02-29')
})
check('week: isWeekStart and invalid dates', () => {
  equal(isWeekStart('2026-09-13'), true)
  equal(isWeekStart('2026-09-14'), false)
  equal(isWeekStart('2026-02-30'), false)
  equal(isWeekStart('nope'), false)
  throws(() => weekStartOf('2026-13-01'), /Not a real calendar date/)
})

// ===========================================================================
// 2. Migration 004
// ===========================================================================
check('migrations 004 + 005 apply on a fresh database (weekly_reviews, weekly_scorecard_entries)', () => {
  const db = Database.open(newDbPath())
  try {
    equal(db.health.schemaVersion, 6)
    equal(db.listAppliedMigrations().map((m) => m.name), ['initial_core', 'trade_source_identity', 'trade_media', 'weekly_reviews', 'weekly_scorecard', 'strategy_display_order'])
  } finally {
    db.close()
  }
})
check('migration 004 upgrades an existing 001–003 database without touching prior data', () => {
  const path = newDbPath()
  const old = Database.open(path, { migrations: MIGRATIONS.slice(0, 3) })
  const account = old.repositories.accounts.create({ displayName: 'Before 004', sourcePlatform: 'dev-fixture', currency: 'USD' })
  old.repositories.trades.createTrade(trade(account.id, '2026-09-14', '10'))
  old.close()
  const before = factsDigest(path)
  const upgraded = Database.open(path)
  try {
    equal(upgraded.health.migrationsAppliedThisOpen, [4, 5, 6])
    equal(upgraded.repositories.accounts.list().map((a) => a.displayName), ['Before 004'])
  } finally {
    upgraded.close()
  }
  equal(factsDigest(path) === before, true, 'historical facts unchanged by migration 004')
  const again = Database.open(path)
  equal(again.health.migrationsAppliedThisOpen, [], 'second open applies nothing')
  again.close()
})
check('migration 005 upgrades an existing 001–004 database without touching prior data or reflections', () => {
  const path = newDbPath()
  const old = Database.open(path, { migrations: MIGRATIONS.slice(0, 4) })
  const account = old.repositories.accounts.create({ displayName: 'Before 005', sourcePlatform: 'dev-fixture', currency: 'USD' })
  old.repositories.trades.createTrade(trade(account.id, '2026-09-14', '10'))
  old.repositories.weeklyReviews.save(account.id, '2026-09-13', { forecast: 'kept exactly ' })
  old.close()
  const before = factsDigest(path)
  const upgraded = Database.open(path)
  try {
    equal(upgraded.health.migrationsAppliedThisOpen, [5, 6])
    const got = new ReviewService(upgraded).getWeek(account.id, '2026-09-13')
    equal(got.reflection.forecast, 'kept exactly ')
    equal(WEEKLY_SCORECARD_DIMENSIONS.every((d) => got.scorecard[d].score === null && got.scorecard[d].note === ''), true, 'no invented scores')
  } finally {
    upgraded.close()
  }
  equal(factsDigest(path) === before, true, 'historical facts unchanged by migration 005')
})

// ===========================================================================
// 3. Fixture: two accounts, mixed Strategy Versions, boundary trades
// ===========================================================================
const WEEK = '2026-09-13'
const mainPath = newDbPath()
const db = Database.open(mainPath, { clock: makeClock() })
seedDevelopmentStrategies(db)
const r = db.repositories
const alpha = must(r.strategies.list().find((s) => s.name === 'Strategy Alpha'), 'Strategy Alpha')
const [alphaV1, alphaV2] = r.strategyVersions.listPublished(alpha.id)
const v1 = must(alphaV1, 'Alpha v1')
const v2 = must(alphaV2, 'Alpha v2')
const v1Rules = r.strategyVersions.listRules(v1.id)
const v2Rules = r.strategyVersions.listRules(v2.id)
const accountA = r.accounts.create({ displayName: 'Account A', sourcePlatform: 'dev-fixture', sourceAccountId: 'wr-a', currency: 'USD', timezone: 'America/New_York' })
const accountB = r.accounts.create({ displayName: 'Account B', sourcePlatform: 'dev-fixture', sourceAccountId: 'wr-b', currency: 'USD', timezone: null })

function evaluate(tradeId: string, versionId: string, states: (i: number, n: number) => EvaluationState): void {
  r.trades.associateStrategyVersion(tradeId, versionId)
  const rules = r.strategyVersions.listRules(versionId)
  rules.forEach((rule, i) => {
    const state = states(i, rules.length)
    if (state !== 'UNREVIEWED') r.evaluations.setState(tradeId, rule.id, state)
  })
}

// Week W (Sun 09-13 .. Sat 09-19), account A:
const t1 = r.trades.createTrade({ ...trade(accountA.id, '2026-09-14', '200', { r: '2', openedAt: Date.parse('2026-09-14T13:30:00Z') }), grossPnl: '205', commission: '-5' })
const t2 = r.trades.createTrade(trade(accountA.id, '2026-09-14', '-100', { direction: 'SHORT', r: '-1', openedAt: Date.parse('2026-09-14T15:00:00Z') }))
const t3 = r.trades.createTrade(trade(accountA.id, '2026-09-16', '5')) // break-even by the |net| < 10 threshold; no Strategy; no R
const t4 = r.trades.createTrade(trade(accountA.id, '2026-09-17', '-50', { direction: 'SHORT' })) // v2, all UNREVIEWED, no R
const t5 = r.trades.createTrade(trade(accountA.id, '2026-09-19', '300', { r: '3' })) // v2 with a FAIL and an N/A
evaluate(t1.id, v1.id, (i) => (i === 0 ? 'FAIL' : 'PASS'))
evaluate(t2.id, v2.id, () => 'PASS') // a LOSS with 100% compliance
evaluate(t4.id, v2.id, () => 'UNREVIEWED')
evaluate(t5.id, v2.id, (i) => (i === 0 ? 'FAIL' : i === 1 ? 'N/A' : 'PASS')) // a WIN with a FAIL
// Boundaries (must be excluded from W): previous Saturday, next Sunday.
const tPrev = r.trades.createTrade(trade(accountA.id, '2026-09-12', '1000'))
const tNext = r.trades.createTrade(trade(accountA.id, '2026-09-20', '-1000'))
// Account B, same week (must never appear on A).
const tB = r.trades.createTrade(trade(accountB.id, '2026-09-15', '777'))
// Day Note + Chart Evidence (metadata rows only; no files are needed for the facts).
r.notes.upsertDayNote(accountA.id, '2026-09-16', 'Plan: patience.')
r.notes.upsertDayNote(accountA.id, '2026-09-18', '   ') // blank: not a note
const dayMedia = r.media.createForDay({ accountId: accountA.id, analyticalDate: '2026-09-14', managedPath: 'day/a.png', format: 'PNG', timeframe: 'M5', stage: 'POST_TRADE', caption: null })
const featured = r.media.createForTrade({ tradeId: t5.id, accountId: accountA.id, managedPath: 'trade/f.png', format: 'PNG', timeframe: 'M1', stage: 'ENTRY', caption: 'entry', isFeatured: true })
const notFeatured = r.media.createForTrade({ tradeId: t5.id, accountId: accountA.id, managedPath: 'trade/n.png', format: 'PNG', timeframe: 'M1', stage: 'EXIT', caption: null, isFeatured: false })
r.media.createForDay({ accountId: accountA.id, analyticalDate: '2026-09-20', managedPath: 'day/out.png', format: 'PNG', timeframe: 'M5', stage: 'POST_TRADE', caption: null })
r.media.createForDay({ accountId: accountB.id, analyticalDate: '2026-09-15', managedPath: 'day/b.png', format: 'PNG', timeframe: 'M5', stage: 'POST_TRADE', caption: null })

const service = new ReviewService(db)
const factsBefore = factsDigest(mainPath)
const week: WeeklyReviewDto = service.getWeek(accountA.id, WEEK)
const ids = (list: readonly TradeSummaryDto[]): string[] => list.map((t) => t.id)

check('fixture sanity: Alpha v2 has at least two rules', () => equal(v2Rules.length >= 2 && v1Rules.length >= 1, true))

check('scoping: only account A trades inside the week, chronological', () => {
  equal(ids(week.trades), [t1.id, t2.id, t3.id, t4.id, t5.id])
  equal(week.weekStart, WEEK)
  equal(week.weekEnd, '2026-09-19')
  equal(week.account.id, accountA.id)
})
check('scoping: boundary trades (prev Saturday / next Sunday) are excluded', () => {
  equal(ids(week.trades).includes(tPrev.id) || ids(week.trades).includes(tNext.id), false)
})
check('scoping: no cross-account trades; account B sees only its own', () => {
  equal(ids(week.trades).includes(tB.id), false)
  const weekB = service.getWeek(accountB.id, WEEK)
  equal(ids(weekB.trades), [tB.id])
  equal(weekB.ruleResults.length, 0)
  equal(weekB.media.map((m) => m.accountId), [accountB.id])
})

// ===========================================================================
// 4. Outcome metrics
// ===========================================================================
const outcome = computeOutcomeMetrics(week.trades)
check('outcome: trade count and net P&L (exact decimals)', () => {
  equal(outcome.trades, 5)
  equal(outcome.netPnl, '355')
  equal(outcome.grossPnl, '205', 'only t1 reported gross; others are null, never zero')
})
check('outcome: Win Rate uses the Day Review classification (winners / trades)', () => {
  equal([outcome.winners, outcome.losers, outcome.breakEven], [2, 2, 1])
  equal(outcome.winRate, 40)
})
check('outcome: average winner / loser', () => {
  equal(outcome.avgWinner, '250')
  equal(outcome.avgLoser, '-75')
})
check('outcome: Profit Factor = gross profit / |gross loss|', () => {
  equal(outcome.grossProfit, '505')
  equal(outcome.grossLoss, '-150')
  equal(Math.round((outcome.profitFactor ?? 0) * 10000) / 10000, 3.3667)
})
check('outcome: LONG / SHORT counts', () => equal([outcome.long, outcome.short], [3, 2]))
check('outcome: days traded and winning / losing / break-even days', () => {
  equal(outcome.daysTraded, 4)
  equal([outcome.winningDays, outcome.losingDays, outcome.breakEvenDays], [3, 1, 0])
})
check('outcome: R only from trades that carry R (NULL R never becomes 0R)', () => {
  equal(outcome.tradesWithR, 3)
  equal(outcome.totalR, '4')
  equal(outcome.avgR, '1.33333333')
})
check('outcome: largest gain / loss are factual extremes by net P&L', () => {
  equal(outcome.largestGain?.id, t5.id)
  equal(outcome.largestLoss?.id, t2.id)
})

// ===========================================================================
// 5. Process metrics + compliance math
// ===========================================================================
const process_ = computeProcessMetrics(week.trades)
const n1 = v1Rules.length
const n2 = v2Rules.length
check('process: PASS / FAIL / N/A / UNREVIEWED counts pooled from evaluations', () => {
  equal(process_.pooled.pass, n1 - 1 + n2 + (n2 - 2))
  equal(process_.pooled.fail, 2)
  equal(process_.pooled.na, 1)
  equal(process_.pooled.unreviewed, n2)
})
check('process: compliance denominator is PASS + FAIL (N/A and UNREVIEWED excluded)', () => {
  const pass = n1 - 1 + n2 + (n2 - 2)
  equal(process_.pooled.evaluated, pass + 2)
  equal(process_.pooled.percent, Math.round((pass / (pass + 2)) * 100))
})
check('process: review completeness is separate from compliance', () => {
  equal(process_.pooled.reviewComplete, false)
  equal(process_.pooled.reviewed, process_.pooled.total - n2)
  equal(process_.reviewed, 3)
  equal(process_.unreviewed, 1)
})
check('process: no-Strategy trade is its own bucket, never FAIL or UNREVIEWED', () => {
  equal(process_.noStrategy, 1)
  equal(process_.withStrategy, 4)
})
check('process: fully compliant vs at-least-one-FAIL; P&L is not an input', () => {
  equal(process_.fullyCompliant, 1, 'the losing t2 is the fully compliant one')
  equal(process_.withFail, 2, 'the winning t5 has a FAIL')
  equal(process_.versions, 2)
})
check('process: highest / lowest compliance are distinct factual categories', () => {
  equal(process_.highestCompliance?.trade.id, t2.id)
  equal(process_.highestCompliance?.percent, 100)
  const t1Pct = Math.round(((n1 - 1) / n1) * 100)
  const t5Pct = Math.round(((n2 - 2) / (n2 - 1)) * 100)
  const lowest = must(process_.lowestCompliance, 'lowest')
  equal(lowest.percent, Math.min(t1Pct, t5Pct))
  equal(lowest.trade.id, t5Pct < t1Pct ? t5.id : t1.id)
})
check('process: identical inputs with flipped P&L give identical process metrics', () => {
  const flipped = week.trades.map((t) => ({ ...t, netPnl: t.netPnl === null ? null : t.netPnl.startsWith('-') ? t.netPnl.slice(1) : `-${t.netPnl}` }))
  equal(JSON.stringify(computeProcessMetrics(flipped).pooled), JSON.stringify(process_.pooled))
})

// ===========================================================================
// 6. Rule review + Strategy Version integrity
// ===========================================================================
check('rules: grouped by exact version; mixed versions stay separate', () => {
  const versions = computeRuleReview(week.ruleResults, week.trades)
  equal(versions.map((v) => v.versionNumber).sort(), [1, 2])
  equal(must(versions.find((v) => v.versionId === v1.id), 'v1').trades, 1)
  equal(must(versions.find((v) => v.versionId === v2.id), 'v2').trades, 3)
})
check('rules: FAIL counts are factual per rule, with descriptive outcomes only', () => {
  const violations = ruleViolations(computeRuleReview(week.ruleResults, week.trades))
  equal(violations.length, 2)
  equal(violations.map((v) => v.ruleId).sort(), [must(v1Rules[0], 'v1 r0').id, must(v2Rules[0], 'v2 r0').id].sort())
  for (const v of violations) {
    equal(v.fail, 1)
    equal(v.failedOutcomes, { positive: 1, negative: 0, 'break-even': 0 })
  }
})
check('rules: missing evaluations never become FAIL', () => {
  const unreviewedTrade = week.ruleResults.filter((x) => x.tradeId === t4.id)
  equal(unreviewedTrade.length, n2)
  equal(unreviewedTrade.every((x) => x.state === 'Unreviewed'), true)
  equal(week.ruleResults.some((x) => x.tradeId === t3.id), false, 'no-Strategy trade has no fabricated evaluations')
})
check('rules: wording comes from the evaluated version, not the latest', () => {
  equal(week.ruleResults.filter((x) => x.tradeId === t1.id).map((x) => x.ruleName), v1Rules.map((x) => x.title))
})
check('version integrity: a newer published version + rename never reinterprets the week', () => {
  const draft = r.strategyVersions.createDraft(alpha.id)
  const draftRule = must(r.strategyVersions.listRules(draft.id)[0], 'draft rule')
  r.strategyVersions.updateRule(draftRule.id, { title: 'Rule A — rewritten in a later version' })
  const published = r.strategyVersions.publishDraft(alpha.id)
  r.strategies.updateMetadata(alpha.id, { name: 'Strategy Alpha (renamed)' })
  const again = service.getWeek(accountA.id, WEEK)
  equal(again.ruleResults.some((x) => x.versionId === published.id), false)
  equal(again.ruleResults.filter((x) => x.tradeId === t1.id).map((x) => [x.versionNumber, x.ruleName]), v1Rules.map((x) => [1, x.title]))
  equal(again.ruleResults.every((x) => x.strategyName === 'Strategy Alpha (renamed)'), true, 'current display name, historical rules')
  equal(again.trades.find((t) => t.id === t1.id)?.strategy?.versionNumber, 1)
})

// ===========================================================================
// 7. Daily breakdown + Day Note / media indicators + media reuse
// ===========================================================================
check('daily: exactly 7 days Sun..Sat with trade counts, P&L and indicators', () => {
  const days = computeDailyBreakdown(week.days, week.trades)
  equal(days.map((d) => d.date), weekDates(WEEK))
  equal(days.map((d) => d.weekday), [0, 1, 2, 3, 4, 5, 6])
  equal(days.map((d) => d.trades), [0, 2, 0, 1, 1, 0, 1])
  equal(days[0]?.outcome, 'no-trade')
  equal(days[1]?.netPnl, '100')
  equal(days[3]?.compliance, null, 'Wednesday has only a no-Strategy trade')
  equal(days[4]?.compliance?.percent, null, 'Thursday: all UNREVIEWED → undefined compliance')
  equal(days.map((d) => d.hasDayNote), [false, false, false, true, false, false, false], 'blank note is not a note')
  equal(days.map((d) => d.dayMediaCount), [0, 1, 0, 0, 0, 0, 0])
})
check('media: day charts + featured trade chart only, reused by id via ssmedia://', () => {
  equal(week.media.map((m) => m.id).sort(), [dayMedia.id, featured.id].sort())
  equal(week.media.some((m) => m.id === notFeatured.id), false)
  equal(week.media.every((m) => m.url === `ssmedia://${m.id}`), true)
  equal(Object.keys(week.media[0] ?? {}).includes('managedPath'), false, 'no filesystem path crosses the boundary')
})

// ===========================================================================
// 8. Edge-case weeks (pure derivation)
// ===========================================================================
const base = must(week.trades[0], 'base trade')
const mk = (id: string, date: string, net: string | null, extra: Partial<TradeSummaryDto> = {}): TradeSummaryDto => ({
  ...base,
  id,
  tradeDate: date,
  netPnl: net,
  grossPnl: null,
  commission: null,
  realizedR: null,
  strategy: null,
  compliance: { pass: 0, fail: 0, na: 0, unreviewed: 0 },
  ...extra
})
check('empty week: no invented zeros', () => {
  const empty = service.getWeek(accountA.id, '2026-08-30')
  equal(empty.trades.length, 0)
  const o = computeOutcomeMetrics(empty.trades)
  equal([o.trades, o.netPnl, o.winRate, o.avgWinner, o.avgLoser, o.profitFactor, o.totalR, o.daysTraded], [0, null, null, null, null, null, null, 0])
  const p = computeProcessMetrics(empty.trades)
  equal([p.pooled.percent, p.highestCompliance, p.lowestCompliance], [null, null, null])
  equal(computeRuleReview(empty.ruleResults, empty.trades), [])
  equal(empty.days.length, 7)
  equal(empty.reflection.updatedAt, null)
})
check('one-Trade week: extremes defined once, no duplicated lowest', () => {
  const one = [mk('one', '2026-09-14', '50', { strategy: { strategyId: 's', strategyName: 'S', versionId: 'v', versionNumber: 1 }, compliance: { pass: 2, fail: 1, na: 0, unreviewed: 0 } })]
  const o = computeOutcomeMetrics(one)
  equal([o.trades, o.winRate, o.avgWinner, o.avgLoser, o.profitFactor], [1, 100, '50', null, null])
  const p = computeProcessMetrics(one)
  equal(p.highestCompliance?.percent, 67)
  equal(p.lowestCompliance, null)
})
check('all-loss week: Profit Factor 0, no average winner', () => {
  const o = computeOutcomeMetrics([mk('a', '2026-09-14', '-20'), mk('b', '2026-09-15', '-30')])
  equal([o.profitFactor, o.winRate, o.avgWinner, o.avgLoser, o.losingDays, o.largestGain], [0, 0, null, '-25', 2, null])
})
check('all-win week: Profit Factor undefined (null), no average loser', () => {
  const o = computeOutcomeMetrics([mk('a', '2026-09-14', '20'), mk('b', '2026-09-15', '30')])
  equal([o.profitFactor, o.winRate, o.avgLoser, o.avgWinner, o.winningDays, o.largestLoss], [null, 100, null, '25', 2, null])
})
check('break-even handling: zero-P&L week and null P&L', () => {
  const o = computeOutcomeMetrics([mk('a', '2026-09-14', '0'), mk('b', '2026-09-14', null), mk('c', '2026-09-15', '-5')])
  equal([o.winners, o.losers, o.breakEven], [0, 0, 3])
  equal(o.netPnl, '-5')
  equal([o.breakEvenDays, o.losingDays], [1, 1], 'day totals use the Calendar sign rule')
  equal(o.profitFactor, 0)
  const zero = computeOutcomeMetrics([mk('z', '2026-09-14', '0')])
  equal([zero.netPnl, zero.profitFactor, zero.grossProfit, zero.grossLoss], ['0', null, '0', '0'])
})
check('NULL R is never 0R', () => {
  const o = computeOutcomeMetrics([mk('a', '2026-09-14', '10'), mk('b', '2026-09-14', '-10', { realizedR: '0' })])
  equal([o.tradesWithR, o.totalR, o.avgR], [1, '0', '0'], 'an explicit 0R counts; a missing R does not')
  equal(computeOutcomeMetrics([mk('a', '2026-09-14', '10')]).totalR, null)
})
check('all UNREVIEWED: compliance undefined, nothing counted as FAIL', () => {
  const p = computeProcessMetrics([mk('u', '2026-09-14', '10', { strategy: { strategyId: 's', strategyName: 'S', versionId: 'v', versionNumber: 1 }, compliance: { pass: 0, fail: 0, na: 0, unreviewed: 4 } })])
  equal([p.pooled.percent, p.withFail, p.unreviewed, p.reviewed, p.fullyCompliant], [null, 0, 1, 0, 0])
})
check('exact decimal averaging rounds half away from zero at 8 dp', () => {
  equal(divideDecimal('1', 3), '0.33333333')
  equal(divideDecimal('-2', 3), '-0.66666667')
  equal(divideDecimal('10', 4), '2.5')
})

// ===========================================================================
// 9. Authored reflection persistence
// ===========================================================================
const exact = '  Esperaba rango el lunes;\n\tNQ expandió el miércoles — “sin FOMO”.  \n\n'
check('reflection: authored fields persist exactly as typed (no trim / no translation)', () => {
  const saved = service.saveWeek(accountA.id, WEEK, { forecast: exact, actual: 'Mon–Tue rotational; Wed expanded.' })
  equal(saved.forecast, exact)
  equal(saved.actual, 'Mon–Tue rotational; Wed expanded.')
  equal(service.getWeek(accountA.id, WEEK).reflection.forecast, exact)
})
check('reflection: partial saves keep other fields', () => {
  service.saveWeek(accountA.id, WEEK, { wentWell: 'Waited for my setup.', nextWeekFocus: 'Stop after two losses.' })
  const got = service.getWeek(accountA.id, WEEK).reflection
  equal([got.forecast, got.actual, got.wentWell, got.nextWeekFocus, got.notes], [exact, 'Mon–Tue rotational; Wed expanded.', 'Waited for my setup.', 'Stop after two losses.', ''])
})
check('reflection: forecast timestamp moves only when the forecast text changes', () => {
  const first = service.getWeek(accountA.id, WEEK).reflection.forecastUpdatedAt
  service.saveWeek(accountA.id, WEEK, { notes: 'unrelated edit' })
  equal(service.getWeek(accountA.id, WEEK).reflection.forecastUpdatedAt, first)
  service.saveWeek(accountA.id, WEEK, { forecast: exact })
  equal(service.getWeek(accountA.id, WEEK).reflection.forecastUpdatedAt, first, 'same text is not a change')
  const changed = service.saveWeek(accountA.id, WEEK, { forecast: `${exact}more` })
  equal((changed.forecastUpdatedAt ?? 0) > (first ?? 0), true)
  service.saveWeek(accountA.id, WEEK, { forecast: exact })
})
check('reflection: account isolation — the same week on account B is empty', () => {
  const b = service.getWeek(accountB.id, WEEK).reflection
  equal([b.forecast, b.wentWell, b.updatedAt], ['', '', null])
})
check('reflection: listWeeks reports traded and authored weeks per account', () => {
  const weeksA = service.listWeeks(accountA.id)
  equal(weeksA.tradedWeeks, ['2026-09-20', '2026-09-13', '2026-09-06'])
  equal(weeksA.authoredWeeks, [WEEK])
  service.saveWeek(accountB.id, '2026-09-06', { notes: '   \n ' })
  equal(service.listWeeks(accountB.id).authoredWeeks, [], 'whitespace-only is not an authored review')
})
check('reflection: non-canonical week start and unknown account are refused', () => {
  throws(() => service.saveWeek(accountA.id, '2026-09-14', { notes: 'x' }), /first day of a review week/)
  throws(() => service.getWeek(accountA.id, '2026-09-15'), /first day of a review week/)
  throws(() => service.getWeek('no-such-account', WEEK), /Account not found/)
})
check('reflection: review identity is immutable at the schema level', () => {
  const raw = new DatabaseSync(mainPath)
  try {
    raw.exec('PRAGMA foreign_keys = ON')
    throws(() => raw.prepare(`UPDATE weekly_reviews SET week_start_date = '2026-09-20' WHERE week_start_date = ?`).run(WEEK), /identity is immutable/)
  } finally {
    raw.close()
  }
})
// ===========================================================================
// 9b. Weekly Scorecard persistence (migration 005)
// ===========================================================================
const note = '  Esperé mi setup;\n“sin FOMO”  '
check('scorecard: an unrated week returns every dimension as { score: null, note: "" }', () => {
  const card = service.getWeek(accountA.id, WEEK).scorecard
  equal(Object.keys(card), [...WEEKLY_SCORECARD_DIMENSIONS])
  equal(WEEKLY_SCORECARD_DIMENSIONS.map((d) => card[d]), WEEKLY_SCORECARD_DIMENSIONS.map(() => ({ score: null, note: '' })))
})
check('scorecard: scores and notes persist exactly (no trim / no translation)', () => {
  const saved = service.saveScorecard(accountA.id, WEEK, { discipline: { score: 4, note }, patience: { score: 2 } })
  equal(saved.discipline, { score: 4, note })
  equal(saved.patience, { score: 2, note: '' })
  equal(service.getWeek(accountA.id, WEEK).scorecard.discipline.note, note)
})
check('scorecard: partial saves — score and note are independent, other dimensions untouched', () => {
  service.saveScorecard(accountA.id, WEEK, { discipline: { note: 'only the note changed' } })
  service.saveScorecard(accountA.id, WEEK, { patience: { score: 3 } })
  const card = service.getWeek(accountA.id, WEEK).scorecard
  equal(card.discipline, { score: 4, note: 'only the note changed' })
  equal(card.patience, { score: 3, note: '' })
  equal(card.focus, { score: null, note: '' })
  service.saveScorecard(accountA.id, WEEK, { discipline: { note } })
})
check('scorecard: null clears a score without touching the note', () => {
  service.saveScorecard(accountA.id, WEEK, { focus: { score: 5, note: 'n' } })
  service.saveScorecard(accountA.id, WEEK, { focus: { score: null } })
  equal(service.getWeek(accountA.id, WEEK).scorecard.focus, { score: null, note: 'n' })
})
check('scorecard: saving it never changes the authored reflection (and vice versa)', () => {
  const before = service.getWeek(accountA.id, WEEK).reflection
  service.saveScorecard(accountA.id, WEEK, { review_quality: { score: 5, note: 'x' } })
  const after = service.getWeek(accountA.id, WEEK).reflection
  equal(WEEKLY_REFLECTION_FIELDS.map((f) => after[f]), WEEKLY_REFLECTION_FIELDS.map((f) => before[f]))
  equal([after.forecastUpdatedAt, after.updatedAt], [before.forecastUpdatedAt, before.updatedAt], 'reflection row not rewritten')
  const cardBefore = service.getWeek(accountA.id, WEEK).scorecard
  service.saveWeek(accountA.id, WEEK, { notes: 'unrelated edit 2' })
  equal(service.getWeek(accountA.id, WEEK).scorecard, cardBefore)
})
check('scorecard: account isolation — the same week on account B is unrated', () => {
  const b = service.getWeek(accountB.id, WEEK).scorecard
  equal(WEEKLY_SCORECARD_DIMENSIONS.every((d) => b[d].score === null && b[d].note === ''), true)
})
check('scorecard: listWeeks counts a scorecard-only week as authored; blank notes do not', () => {
  service.saveScorecard(accountB.id, '2026-08-30', { patience: { note: ' \n\t' } })
  equal(service.listWeeks(accountB.id).authoredWeeks, [], 'whitespace-only note is not authored')
  service.saveScorecard(accountB.id, '2026-08-30', { patience: { score: 1 } })
  equal(service.listWeeks(accountB.id).authoredWeeks, ['2026-08-30'])
})
check('scorecard: out-of-range scores and unknown dimensions are refused at the schema / service level', () => {
  const raw = new DatabaseSync(mainPath)
  try {
    throws(() => raw.prepare(`UPDATE weekly_scorecard_entries SET score = 6 WHERE dimension = 'discipline'`).run(), /CHECK constraint/)
    throws(() => raw.prepare(`UPDATE weekly_scorecard_entries SET score = 0 WHERE dimension = 'discipline'`).run(), /CHECK constraint/)
    throws(() => raw.prepare(`UPDATE weekly_scorecard_entries SET dimension = 'focus' WHERE dimension = 'discipline'`).run(), /identity is immutable/)
  } finally {
    raw.close()
  }
  throws(() => service.saveScorecard(accountA.id, WEEK, { pnl: { score: 3 } } as never), /Unknown scorecard dimension/)
  throws(() => service.saveScorecard(accountA.id, '2026-09-14', { focus: { score: 3 } }), /first day of a review week/)
  throws(() => service.saveScorecard('no-such-account', WEEK, { focus: { score: 3 } }), /Account not found/)
})

// ===========================================================================
// 9c. Progress bars + achievements (pure, derived, never persisted)
// ===========================================================================
const S = { strategyId: 's', strategyName: 'S', versionId: 'v', versionNumber: 1 }
const fullCard = (score: number | null): Record<WeeklyScorecardDimension, { score: number | null }> => {
  const card = {} as Record<WeeklyScorecardDimension, { score: number | null }>
  for (const d of WEEKLY_SCORECARD_DIMENSIONS) card[d] = { score }
  return card
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as object)) deepFreeze(v)
  }
  return value
}
const earnedIds = (input: AchievementInput): string[] => computeAchievements(input).filter((a) => a.earned).map((a) => a.id)

check('progress: fixture week (partial review) — compliance = PASS / (PASS + FAIL), completion = reviewed / all Trades', () => {
  const pr = computeWeekProgress(week.trades)
  const pass = n1 - 1 + n2 + (n2 - 2)
  equal([pr.compliance.pass, pr.compliance.fail, pr.compliance.evaluated], [pass, 2, pass + 2])
  equal(pr.compliance.ratio, pass / (pass + 2))
  equal(pr.compliance.percent, process_.pooled.percent, 'same number as the Process section')
  equal([pr.review.reviewed, pr.review.total, pr.review.incomplete, pr.review.noStrategy], [3, 5, 1, 1])
  equal([pr.review.ratio, pr.review.percent], [0.6, 60])
})
check('progress: N/A and UNREVIEWED never enter the compliance denominator', () => {
  const pr = computeWeekProgress([mk('a', '2026-09-14', '10', { strategy: S, compliance: { pass: 3, fail: 1, na: 7, unreviewed: 9 } })])
  equal([pr.compliance.evaluated, pr.compliance.ratio, pr.compliance.percent], [4, 0.75, 75])
  equal([pr.review.reviewed, pr.review.ratio], [0, 0], 'a Trade with UNREVIEWED rules is not reviewed')
})
check('progress: no Trades — both bars undefined (null), never 0% or 100%', () => {
  const pr = computeWeekProgress([])
  equal([pr.compliance.ratio, pr.compliance.percent, pr.review.ratio, pr.review.percent, pr.review.total], [null, null, null, null, 0])
})
check('progress: no Strategy — compliance undefined, completion 0% (No-Strategy Trades cannot be reviewed)', () => {
  const pr = computeWeekProgress([mk('a', '2026-09-14', '10'), mk('b', '2026-09-15', '-10')])
  equal([pr.compliance.ratio, pr.compliance.percent], [null, null])
  equal([pr.review.reviewed, pr.review.noStrategy, pr.review.ratio, pr.review.percent], [0, 2, 0, 0])
})
check('progress: Strategy but no evaluations — compliance undefined, completion 0%', () => {
  const pr = computeWeekProgress([mk('a', '2026-09-14', '10', { strategy: S, compliance: { pass: 0, fail: 0, na: 0, unreviewed: 5 } })])
  equal([pr.compliance.percent, pr.review.incomplete, pr.review.percent], [null, 1, 0])
})
check('progress: full review — 100% completion; compliance independent of P&L', () => {
  const trades = [
    mk('a', '2026-09-14', '-80', { strategy: S, compliance: { pass: 4, fail: 0, na: 1, unreviewed: 0 } }),
    mk('b', '2026-09-15', '120', { strategy: S, compliance: { pass: 2, fail: 2, na: 0, unreviewed: 0 } })
  ]
  const pr = computeWeekProgress(trades)
  equal([pr.review.reviewed, pr.review.ratio, pr.review.percent], [2, 1, 100])
  equal([pr.compliance.ratio, pr.compliance.percent], [0.75, 75])
  const flipped = trades.map((t) => ({ ...t, netPnl: t.netPnl?.startsWith('-') ? t.netPnl.slice(1) : `-${t.netPnl}` }))
  equal(computeWeekProgress(flipped), pr)
})

const cleanTrades = [
  mk('c1', '2026-09-14', '-40', { strategy: S, compliance: { pass: 3, fail: 0, na: 1, unreviewed: 0 } }),
  mk('c2', '2026-09-16', '90', { strategy: S, compliance: { pass: 4, fail: 0, na: 0, unreviewed: 0 } })
]
const fullReflection = { ...EMPTY_REFLECTION, forecast: 'f', actual: 'a', wentWell: 'w', needsImprovement: 'n', nextWeekFocus: 'x' }
check('achievements: stable ids, all unearned on an empty, unauthored week', () => {
  const list = computeAchievements({ weekStart: WEEK, trades: [], reflection: EMPTY_REFLECTION, scorecard: fullCard(null), authoredWeeks: [] })
  equal(list.map((a) => a.id), [...ACHIEVEMENT_IDS])
  equal(list.filter((a) => a.earned).length, 0)
})
check('achievements: fixture week (a FAIL, an UNREVIEWED, a No-Strategy Trade) earns no process achievement', () => {
  const ids = earnedIds({ weekStart: WEEK, trades: week.trades, reflection: EMPTY_REFLECTION, scorecard: fullCard(null), authoredWeeks: [] })
  equal(ids, [])
})
check('achievements: clean, fully reviewed week earns the process set — regardless of P&L', () => {
  const input = { weekStart: WEEK, trades: cleanTrades, reflection: EMPTY_REFLECTION, scorecard: fullCard(null), authoredWeeks: [] }
  equal(earnedIds(input), ['tradesReviewed', 'noRuleFails', 'cleanProcess'])
  const allLosses = cleanTrades.map((t) => ({ ...t, netPnl: '-500' }))
  equal(earnedIds({ ...input, trades: allLosses }), ['tradesReviewed', 'noRuleFails', 'cleanProcess'], 'P&L is not an input')
})
check('achievements: one FAIL removes No FAIL / Clean process but keeps All Trades reviewed', () => {
  const withFail = [cleanTrades[0], mk('f', '2026-09-17', '10', { strategy: S, compliance: { pass: 1, fail: 1, na: 0, unreviewed: 0 } })]
  equal(earnedIds({ weekStart: WEEK, trades: withFail, reflection: EMPTY_REFLECTION, scorecard: fullCard(null), authoredWeeks: [] }), ['tradesReviewed'])
})
check('achievements: No-Strategy Trade blocks All Trades reviewed / Clean process (never counted as reviewed)', () => {
  const ids = earnedIds({ weekStart: WEEK, trades: [...cleanTrades, mk('ns', '2026-09-18', '5')], reflection: EMPTY_REFLECTION, scorecard: fullCard(null), authoredWeeks: [] })
  equal(ids, ['noRuleFails'])
})
check('achievements: more Trades never earn more — one clean Trade qualifies like many', () => {
  const one = earnedIds({ weekStart: WEEK, trades: [cleanTrades[0]], reflection: EMPTY_REFLECTION, scorecard: fullCard(null), authoredWeeks: [] })
  const many = earnedIds({ weekStart: WEEK, trades: cleanTrades, reflection: EMPTY_REFLECTION, scorecard: fullCard(null), authoredWeeks: [] })
  equal(one, many)
})
check('achievements: Forecast completed needs both forecast and actual (whitespace does not count)', () => {
  const base = { weekStart: WEEK, trades: [], scorecard: fullCard(null), authoredWeeks: [] }
  equal(earnedIds({ ...base, reflection: { ...EMPTY_REFLECTION, forecast: 'f' } }), [])
  equal(earnedIds({ ...base, reflection: { ...EMPTY_REFLECTION, forecast: 'f', actual: ' \n ' } }), [])
  equal(earnedIds({ ...base, reflection: { ...EMPTY_REFLECTION, forecast: 'f', actual: 'a' } }), ['forecastCompleted'])
})
check('achievements: Review complete needs every scorecard dimension rated + core reflection written', () => {
  const base = { weekStart: WEEK, trades: [], authoredWeeks: [] }
  const partial = fullCard(3)
  partial.focus = { score: null }
  equal(earnedIds({ ...base, reflection: fullReflection, scorecard: partial }).includes('reviewComplete'), false)
  equal(earnedIds({ ...base, reflection: { ...fullReflection, nextWeekFocus: '' }, scorecard: fullCard(3) }).includes('reviewComplete'), false)
  equal(earnedIds({ ...base, reflection: fullReflection, scorecard: fullCard(1) }).includes('reviewComplete'), true, 'low self-ratings still complete the review')
})
check(`achievements: Consistent reviewer needs ${CONSISTENT_REVIEWER_WEEKS} consecutive authored weeks including this one`, () => {
  const prev = (k: number): string => addDays(WEEK, -7 * k)
  const base = { weekStart: WEEK, trades: [], scorecard: fullCard(null) }
  const authoredNow = { ...EMPTY_REFLECTION, notes: 'n' }
  equal(earnedIds({ ...base, reflection: authoredNow, authoredWeeks: [prev(1), prev(2), prev(3)] }).includes('consistentReviewer'), true)
  equal(earnedIds({ ...base, reflection: authoredNow, authoredWeeks: [prev(1), prev(3), prev(4)] }).includes('consistentReviewer'), false, 'a gap breaks the streak')
  equal(earnedIds({ ...base, reflection: EMPTY_REFLECTION, authoredWeeks: [prev(1), prev(2), prev(3)] }).includes('consistentReviewer'), false, 'this week must be authored')
  equal(earnedIds({ ...base, reflection: EMPTY_REFLECTION, scorecard: fullCard(2), authoredWeeks: [prev(1), prev(2), prev(3)] }).includes('consistentReviewer'), true, 'a scorecard counts as authoring')
})
check('achievements + progress are pure: deep-frozen inputs are not mutated and results are repeatable', () => {
  const trades = deepFreeze(week.trades.map((t) => ({ ...t })))
  const snapshot = JSON.stringify(trades)
  const input = deepFreeze({ weekStart: WEEK, trades, reflection: { ...fullReflection }, scorecard: fullCard(4), authoredWeeks: [addDays(WEEK, -7)] })
  const first = JSON.stringify([computeAchievements(input), computeWeekProgress(trades)])
  const second = JSON.stringify([computeAchievements(input), computeWeekProgress(trades)])
  equal(first, second)
  equal(JSON.stringify(trades), snapshot)
})
check('achievements / progress are never persisted: no table or column for them exists', () => {
  const raw = new DatabaseSync(mainPath, { readOnly: true })
  try {
    const cols = raw
      .prepare(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`)
      .all()
      .map((r) => `${String(r['t'])}.${String(r['c'])}`)
    equal(cols.filter((c) => /achiev|progress|complian|badge/i.test(c)), [])
  } finally {
    raw.close()
  }
})

check('no historical Trade / execution / evaluation / note / media fact changed by Weekly Review reads or saves', () => {
  // The version-integrity check above deliberately published a newer version
  // (new strategy_versions / rules rows); compare only the Trade-side facts.
  const tradeSide = (s: string): string => s.split('\n---\n').slice(0, 6).join('\n---\n')
  equal(tradeSide(factsDigest(mainPath)) === tradeSide(factsBefore), true)
})
db.close()

check('restart: authored reflection and scorecard survive close + reopen', () => {
  const reopened = Database.open(mainPath)
  try {
    const got = new ReviewService(reopened).getWeek(accountA.id, WEEK).reflection
    equal([got.forecast, got.wentWell, got.nextWeekFocus], [exact, 'Waited for my setup.', 'Stop after two losses.'])
    const card = new ReviewService(reopened).getWeek(accountA.id, WEEK).scorecard
    equal([card.discipline, card.patience, card.focus, card.review_quality], [{ score: 4, note }, { score: 3, note: '' }, { score: null, note: 'n' }, { score: 5, note: 'x' }])
    equal(reopened.health.migrationsAppliedThisOpen, [])
  } finally {
    reopened.close()
  }
})

// ===========================================================================
// 10. IPC handlers
// ===========================================================================
{
  const hdb = Database.open(newDbPath())
  const acct = hdb.repositories.accounts.create({ displayName: 'H', sourcePlatform: 'dev-fixture', currency: 'USD' })
  const handlers = createReviewHandlers({ getService: () => new ReviewService(hdb), log: () => undefined })
  const C = REVIEW_CHANNELS
  check('ipc: getWeek / saveWeek / listWeeks round trip', () => {
    const saved = handlers[C.saveWeek]({ accountId: acct.id, weekStart: WEEK, fields: { forecast: ' x ' } }) as IpcResult<WeeklyReflectionDto>
    equal(saved.ok && saved.data.forecast, ' x ')
    const got = handlers[C.getWeek]({ accountId: acct.id, weekStart: WEEK }) as IpcResult<WeeklyReviewDto>
    equal(got.ok && got.data.reflection.forecast, ' x ')
    const weeks = handlers[C.listWeeks](acct.id) as IpcResult<{ authoredWeeks: string[] }>
    equal(weeks.ok && weeks.data.authoredWeeks, [WEEK])
  })
  check('ipc: saveScorecard round trip (exact note, score clear)', () => {
    const saved = handlers[C.saveScorecard]({ accountId: acct.id, weekStart: WEEK, entries: { patience: { score: 5, note: ' p ' }, focus: { score: null } } }) as IpcResult<WeeklyScorecardDto>
    equal(saved.ok && saved.data.patience, { score: 5, note: ' p ' })
    equal(saved.ok && saved.data.focus, { score: null, note: '' })
    const got = handlers[C.getWeek]({ accountId: acct.id, weekStart: WEEK }) as IpcResult<WeeklyReviewDto>
    equal(got.ok && got.data.scorecard.patience, { score: 5, note: ' p ' })
    equal(got.ok && got.data.reflection.forecast, ' x ', 'reflection untouched by the scorecard save')
  })
  check('ipc: invalid scorecard payloads are INVALID_INPUT', () => {
    const code = (res: unknown): string => ((res as IpcResult<unknown>).ok ? 'ok' : (res as { error: { code: string } }).error.code)
    const save = (entries: unknown, weekStart = WEEK): string => code(handlers[C.saveScorecard]({ accountId: acct.id, weekStart, entries }))
    for (const bad of [0, 6, 2.5, '3', true]) equal(save({ patience: { score: bad } }), 'INVALID_INPUT', `score ${String(bad)}`)
    equal(save({ pnl: { score: 3 } }), 'INVALID_INPUT', 'unknown dimension')
    equal(save({ patience: { score: 3, weight: 1 } }), 'INVALID_INPUT', 'unknown entry field')
    equal(save({ patience: {} }), 'INVALID_INPUT', 'empty entry')
    equal(save({}), 'INVALID_INPUT', 'empty entries')
    equal(save({ patience: { note: 5 } }), 'INVALID_INPUT', 'non-text note')
    equal(save({ patience: { note: 'x'.repeat(501) } }), 'INVALID_INPUT', 'note too long')
    equal(save({ patience: { score: 3 } }, '2026-09-14'), 'INVALID_INPUT', 'non-canonical week')
    equal(save({ patience: { note: 'x'.repeat(500) } }), 'ok', '500 characters is allowed')
  })
  check('ipc: invalid payloads are INVALID_INPUT', () => {
    const code = (res: unknown): string => ((res as IpcResult<unknown>).ok ? 'ok' : (res as { error: { code: string } }).error.code)
    equal(code(handlers[C.getWeek]({ accountId: acct.id, weekStart: '2026-09-14' })), 'INVALID_INPUT')
    equal(code(handlers[C.getWeek]({ accountId: acct.id, weekStart: '2026-02-30' })), 'INVALID_INPUT')
    equal(code(handlers[C.saveWeek]({ accountId: acct.id, weekStart: WEEK, fields: { pnl: '1' } })), 'INVALID_INPUT')
    equal(code(handlers[C.saveWeek]({ accountId: acct.id, weekStart: WEEK, fields: {} })), 'INVALID_INPUT')
    equal(code(handlers[C.saveWeek]({ accountId: acct.id, weekStart: WEEK, fields: { notes: 7 } })), 'INVALID_INPUT')
    equal(code(handlers[C.saveWeek]({ accountId: acct.id, weekStart: WEEK, fields: { notes: 'x'.repeat(20001) } })), 'INVALID_INPUT')
    equal(code(handlers[C.getWeek]({ accountId: 'missing', weekStart: WEEK })), 'NOT_FOUND')
  })
  check('ipc: unavailable database is PERSISTENCE_UNAVAILABLE', () => {
    const down = createReviewHandlers({ getService: () => null, log: () => undefined })
    const res = down[C.getWeek]({ accountId: acct.id, weekStart: WEEK }) as IpcResult<unknown>
    equal(!res.ok && res.error.code, 'PERSISTENCE_UNAVAILABLE')
  })
  hdb.close()
}

rmSync(workDir, { recursive: true, force: true })
log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
