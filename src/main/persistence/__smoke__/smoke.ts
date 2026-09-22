/**
 * Persistence smoke/QA suite. Development tooling only: it is NOT imported by
 * the application and is not part of the production bundle.
 *
 * Run with `npm run smoke:persistence`. It executes inside the real Electron
 * main-process runtime (not system Node) against TEMPORARY databases created
 * under the OS temp directory, and never touches the user's application DB.
 */
import { app } from 'electron'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Database } from '../database'
import { decimalToScaled, scaledToDecimal } from '../fixedPoint'
import { MIGRATIONS } from '../migrations'
import type { Migration } from '../migrator'
import type { NewTrade } from '../repositories/trades'
import type { EvaluationState, StrategyVersion } from '../types'
import { createStrategyHandlers } from '../../ipc/strategyHandlers'
import type { StrategyHandler } from '../../ipc/strategyHandlers'
import { seedDevelopmentStrategies } from '../../strategies/devSeed'
import { runAccountsSmoke } from './accountsSmoke'
import { runTradingSmoke } from './tradingSmoke'
import { StrategyService } from '../../strategies/strategyService'
import type { IpcResult } from '../../../shared/ipc/result'
import { STRATEGY_CHANNELS } from '../../../shared/ipc/strategies'
import type { DraftEdit, StrategyDto } from '../../../shared/ipc/strategies'

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

function require_<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} is missing`)
  return value
}

const workDir = mkdtempSync(join(tmpdir(), 'solid-skill-smoke-'))
let dbCounter = 0
const newDbPath = (): string => join(workDir, `smoke-${(dbCounter += 1)}.db`)

/** Strict clock so ordering-dependent assertions are deterministic. */
function makeClock(): () => number {
  let t = 1_700_000_000_000
  return () => (t += 1000)
}

const EXPECTED_TABLES = [
  'accounts',
  'day_notes',
  'executions',
  'rule_groups',
  'rules',
  'schema_migrations',
  'strategies',
  'strategy_versions',
  'trade_media',
  'trade_notes',
  'trade_rule_evaluations',
  'trades'
]

function listTables(path: string): string[] {
  const raw = new DatabaseSync(path)
  try {
    return raw
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all()
      .map((row) => String(row['name']))
  } finally {
    raw.close()
  }
}

// ---------------------------------------------------------------------------
log(`Electron ${process.versions.electron} / Node ${process.versions.node} / SQLite via node:sqlite`)

// ---- 0. fixed point --------------------------------------------------------
check('fixed-point: exact round trips', () => {
  for (const value of ['0', '1', '-1', '0.1', '0.2', '1234.25', '-0.00000001', '20000.25', '0.01']) {
    equal(scaledToDecimal(decimalToScaled(value)), value, value)
  }
  equal(scaledToDecimal(decimalToScaled('+5.500')), '5.5')
  equal(scaledToDecimal(decimalToScaled('-0')), '0')
  equal(scaledToDecimal(decimalToScaled('0.1') + decimalToScaled('0.2')), '0.3', '0.1+0.2')
  equal(scaledToDecimal(decimalToScaled('90000000000.12345678')), '90000000000.12345678')
})

check('fixed-point: rejects unrepresentable input instead of rounding', () => {
  throws(() => decimalToScaled('0.123456789'), /fractional digits/)
  throws(() => decimalToScaled('1e5'), /Invalid decimal/)
  throws(() => decimalToScaled('abc'), /Invalid decimal/)
  throws(() => decimalToScaled('99999999999999999999'), /storable range/)
})

// ---- A. first start --------------------------------------------------------
const firstPath = newDbPath()
{
  const db = Database.open(firstPath)
  check('A first start: migration 001 applied, foreign keys on, WAL on', () => {
    equal(db.health.migrationsAppliedThisOpen, [1, 2, 3], 'applied this open')
    equal(db.health.schemaVersion, 3, 'schema version')
    equal(db.health.foreignKeys, true, 'foreign keys')
    equal(db.health.journalMode, 'wal', 'journal mode')
    equal(db.listAppliedMigrations(), [
      { version: 1, name: 'initial_core' },
      { version: 2, name: 'trade_source_identity' },
      { version: 3, name: 'trade_media' }
    ])
  })
  db.close()
  check('A first start: expected tables exist', () => {
    equal(listTables(firstPath), EXPECTED_TABLES)
  })
}

check('A foreign keys are actually enforced', () => {
  const db = Database.open(newDbPath())
  try {
    throws(
      () =>
        db.repositories.trades.createTrade({
          accountId: 'no-such-account',
          analyticalTradeDate: '2026-01-05',
          instrument: 'X',
          direction: 'LONG',
          quantity: '1',
          openedAt: 1,
          avgEntryPrice: '1',
          executions: [{ executedAt: 1, side: 'BUY', quantity: '1', price: '1' }]
        }),
      /Account not found/
    )
  } finally {
    db.close()
  }
})

// ---- B. second start -------------------------------------------------------
{
  const path = newDbPath()
  const first = Database.open(path)
  const account = first.repositories.accounts.create({
    displayName: 'Persist Me',
    sourcePlatform: 'tradovate',
    currency: 'USD'
  })
  first.close()
  first.close() // idempotent close

  const second = Database.open(path)
  check('B second start: 001 not re-applied, no duplicate history, data intact', () => {
    equal(second.health.migrationsAppliedThisOpen, [], 'applied this open')
    equal(second.listAppliedMigrations(), [
      { version: 1, name: 'initial_core' },
      { version: 2, name: 'trade_source_identity' },
      { version: 3, name: 'trade_media' }
    ])
    equal(second.repositories.accounts.list().map((a) => a.id), [account.id])
  })
  second.close()
  check('B second start: no duplicate schema objects', () => {
    equal(listTables(path), EXPECTED_TABLES)
  })
}

// ---- migration system behaviour -------------------------------------------
check('migrations: a second migration applies once, in order, on a later start', () => {
  const path = newDbPath()
  const m2: Migration = {
    version: 4,
    name: 'future_change',
    sql: 'CREATE TABLE future_thing (id TEXT PRIMARY KEY) STRICT;'
  }
  const a = Database.open(path, { migrations: [...MIGRATIONS] })
  equal(a.health.migrationsAppliedThisOpen, [1, 2, 3])
  a.close()
  const b = Database.open(path, { migrations: [...MIGRATIONS, m2] })
  equal(b.health.migrationsAppliedThisOpen, [4])
  b.close()
  const c = Database.open(path, { migrations: [...MIGRATIONS, m2] })
  equal(c.health.migrationsAppliedThisOpen, [])
  equal(c.listAppliedMigrations().map((m) => m.version), [1, 2, 3, 4])
  c.close()
})

check('migrations: a failing migration rolls back completely and is not recorded', () => {
  const path = newDbPath()
  const bad: Migration = {
    version: 4,
    name: 'broken',
    sql: 'CREATE TABLE half_done (id TEXT) STRICT; INSERT INTO no_such_table VALUES (1);'
  }
  const a = Database.open(path)
  a.close()
  throws(() => Database.open(path, { migrations: [...MIGRATIONS, bad] }), /no_such_table/)
  const b = Database.open(path)
  equal(b.health.schemaVersion, 3)
  b.close()
  equal(listTables(path).includes('half_done'), false, 'half_done leaked')
})

check('migrations: database from a newer build is refused', () => {
  const path = newDbPath()
  const m2: Migration = { version: 4, name: 'newer', sql: 'CREATE TABLE newer_thing (id TEXT) STRICT;' }
  Database.open(path, { migrations: [...MIGRATIONS, m2] }).close()
  throws(() => Database.open(path), /does not know/)
})

check('migrations: editing an applied migration is detected', () => {
  const path = newDbPath()
  Database.open(path).close()
  const tampered: Migration = { ...MIGRATIONS[0]!, sql: `${MIGRATIONS[0]!.sql}\n-- edited` }
  throws(() => Database.open(path, { migrations: [tampered] }), /has been modified/)
})

check('migrations: non-sequential registry is rejected', () => {
  const skipped: Migration = { version: 5, name: 'gap', sql: 'SELECT 1;' }
  throws(() => Database.open(newDbPath(), { migrations: [...MIGRATIONS, skipped] }), /sequential/)
})

check('migration 002: trade source identity is unique per (platform, account); NULL ids unaffected', () => {
  const db2 = Database.open(newDbPath())
  try {
    const acc = db2.repositories.accounts.create({ displayName: 'U', sourcePlatform: 'p', sourceAccountId: 'a', currency: 'USD' })
    const mk = (id: string | null, exec: string): NewTrade => ({
      accountId: acc.id,
      sourceTradeId: id,
      analyticalTradeDate: '2026-01-02',
      instrument: 'X',
      direction: 'LONG',
      quantity: '1',
      openedAt: 1,
      avgEntryPrice: '1',
      executions: [{ sourceExecutionId: exec, executedAt: 1, side: 'BUY', quantity: '1', price: '1' }]
    })
    db2.repositories.trades.createTrade(mk('t1', 'e1'))
    throws(() => db2.repositories.trades.createTrade(mk('t1', 'e2')), /UNIQUE/)
    equal(db2.repositories.trades.list().length, 1, 'failed insert left nothing')
    db2.repositories.trades.createTrade(mk(null, 'e3'))
    db2.repositories.trades.createTrade(mk(null, 'e4'))
    equal(db2.repositories.trades.list().length, 3)
    equal(db2.repositories.trades.findBySourceTradeId('p', acc.id, 't1')?.sourceTradeId, 't1')
    equal(db2.repositories.trades.findBySourceTradeId('p', acc.id, 'nope'), null)
    equal(db2.repositories.trades.findExecutionBySourceId('p', acc.id, 'e1')?.sourceExecutionId, 'e1')
  } finally {
    db2.close()
  }
})

// ---- C. repository smoke ---------------------------------------------------
const smokePath = newDbPath()
const db = Database.open(smokePath, { clock: makeClock() })
const r = db.repositories

const account = r.accounts.create({
  displayName: 'Smoke Account',
  sourcePlatform: 'mt5',
  sourceAccountId: '12345678',
  currency: 'USD',
  timezone: 'Europe/Athens'
})
const strategy = r.strategies.create({ name: 'Smoke Strategy', description: 'test data' })
r.strategyVersions.createDraft(strategy.id)
const draft1 = require_(r.strategyVersions.getDraft(strategy.id), 'draft 1')
const groupA = r.strategyVersions.addGroup(draft1.id, { name: 'Group A' })
const groupB = r.strategyVersions.addGroup(draft1.id, { name: 'Group B', description: 'second' })
const ruleReq = r.strategyVersions.addRule(groupA.id, { title: 'Rule required', kind: 'REQUIRED' })
const ruleOpt = r.strategyVersions.addRule(groupA.id, { title: 'Rule optional', kind: 'OPTIONAL' })
const ruleCond = r.strategyVersions.addRule(groupB.id, {
  title: 'Rule conditional',
  kind: 'CONDITIONAL'
})
const ruleExtra = r.strategyVersions.addRule(groupB.id, { title: 'Rule extra', kind: 'REQUIRED' })

check('C strategy version: draft is unnumbered, exactly one draft per strategy', () => {
  equal(draft1.state, 'DRAFT')
  equal(draft1.versionNumber, null)
  equal(r.strategyVersions.listPublished(strategy.id).length, 0, 'drafts are not listed as versions')
  throws(() => r.strategyVersions.createDraft(strategy.id), /already has a draft/)
})

const v1: StrategyVersion = r.strategyVersions.publishDraft(strategy.id)

check('C strategy version: publish assigns v1 and consumes the draft', () => {
  equal(v1.state, 'PUBLISHED')
  equal(v1.versionNumber, 1)
  equal(v1.id, draft1.id, 'draft row becomes the published version')
  equal(r.strategyVersions.getDraft(strategy.id), null)
})

check('C published version is immutable through the repository', () => {
  throws(() => r.strategyVersions.addGroup(v1.id, { name: 'nope' }), /immutable/)
  throws(() => r.strategyVersions.updateRule(ruleReq.id, { title: 'edited' }), /immutable/)
  throws(() => r.strategyVersions.removeRule(ruleReq.id), /immutable/)
  throws(() => r.strategyVersions.updateGroup(groupA.id, { name: 'edited' }), /immutable/)
  throws(() => r.strategyVersions.removeGroup(groupA.id), /immutable/)
  throws(() => r.strategyVersions.discardDraft(strategy.id), /no draft/)
})

check('C published version is immutable even bypassing the repository (schema triggers)', () => {
  const raw = new DatabaseSync(smokePath)
  try {
    const attempt = (sql: string, pattern: RegExp): void => throws(() => raw.exec(sql), pattern)
    attempt(`UPDATE rules SET title = 'x' WHERE id = '${ruleReq.id}'`, /immutable/)
    attempt(`DELETE FROM rules WHERE id = '${ruleReq.id}'`, /immutable/)
    attempt(`UPDATE rule_groups SET name = 'x' WHERE id = '${groupA.id}'`, /immutable/)
    attempt(`DELETE FROM rule_groups WHERE id = '${groupA.id}'`, /immutable/)
    attempt(`UPDATE strategy_versions SET version_number = 9 WHERE id = '${v1.id}'`, /immutable/)
    attempt(`DELETE FROM strategy_versions WHERE id = '${v1.id}'`, /cannot be deleted/)
    attempt(
      `INSERT INTO rules (id, strategy_version_id, rule_group_id, title, kind, position, created_at, updated_at)
       VALUES ('sneaky', '${v1.id}', '${groupA.id}', 'sneaky', 'REQUIRED', 9, 1, 1)`,
      /can only be added to a draft/
    )
  } finally {
    raw.close()
  }
})

const trade = r.trades.createTrade({
  accountId: account.id,
  sourcePositionId: 'POS-1',
  analyticalTradeDate: '2026-03-02',
  instrument: 'EURUSD',
  direction: 'LONG',
  quantity: '2',
  openedAt: 1_772_000_000_000,
  closedAt: 1_772_000_600_000,
  avgEntryPrice: '1.10005',
  avgExitPrice: '1.10255',
  grossPnl: '500.00',
  commission: '-14.00',
  fees: '-2',
  swap: '-1.5',
  netPnl: '482.5',
  plannedR: '1.5',
  realizedR: '2.25',
  executions: [
    { sourceExecutionId: 'D-1', sourcePositionId: 'POS-1', executedAt: 1_772_000_000_000, side: 'BUY', quantity: '1', price: '1.10000', commission: '-3.5' },
    { sourceExecutionId: 'D-2', sourcePositionId: 'POS-1', executedAt: 1_772_000_060_000, side: 'BUY', quantity: '1', price: '1.10010', commission: '-3.5' },
    { sourceExecutionId: 'D-3', sourcePositionId: 'POS-1', executedAt: 1_772_000_500_000, side: 'SELL', quantity: '1', price: '1.10250', commission: '-3.5' },
    { sourceExecutionId: 'D-4', sourcePositionId: 'POS-1', executedAt: 1_772_000_600_000, side: 'SELL', quantity: '1', price: '1.10260', commission: '-3.5' }
  ]
})

const associated = r.trades.associateStrategyVersion(trade.id, v1.id)
const initialEvals = r.evaluations.listForTrade(trade.id)

check('C association creates one UNREVIEWED evaluation per rule of the exact version', () => {
  equal(associated.strategyVersionId, v1.id)
  equal(initialEvals.length, 4)
  equal(initialEvals.map((e) => e.state), ['UNREVIEWED', 'UNREVIEWED', 'UNREVIEWED', 'UNREVIEWED'])
  equal(initialEvals.every((e) => e.strategyVersionId === v1.id), true, 'all bound to v1')
  equal(initialEvals.every((e) => e.evaluatedAt === null), true, 'no evaluatedAt while UNREVIEWED')
})

// PASS / FAIL / N/A recorded; one rule intentionally left UNREVIEWED.
r.evaluations.setState(trade.id, ruleReq.id, 'PASS')
r.evaluations.setState(trade.id, ruleOpt.id, 'FAIL')
r.evaluations.setState(trade.id, ruleCond.id, 'N/A')

const stateByTitle = (tradeId: string): Record<string, EvaluationState> =>
  Object.fromEntries(r.evaluations.listForTrade(tradeId).map((e) => [e.ruleTitle, e.state]))

check('C evaluations: PASS / FAIL / N/A / UNREVIEWED are distinct persisted states', () => {
  equal(stateByTitle(trade.id), {
    'Rule required': 'PASS',
    'Rule optional': 'FAIL',
    'Rule conditional': 'N/A',
    'Rule extra': 'UNREVIEWED'
  })
  const evals = r.evaluations.listForTrade(trade.id)
  equal(evals.filter((e) => e.state !== 'UNREVIEWED').every((e) => e.evaluatedAt !== null), true)
  equal(evals.find((e) => e.ruleId === ruleExtra.id)?.evaluatedAt, null, 'UNREVIEWED has no evaluatedAt')
})

check('C evaluations: state can change, coordinates cannot (schema triggers)', () => {
  r.evaluations.setState(trade.id, ruleExtra.id, 'PASS')
  r.evaluations.setState(trade.id, ruleExtra.id, 'UNREVIEWED')
  equal(stateByTitle(trade.id)['Rule extra'], 'UNREVIEWED')
  const raw = new DatabaseSync(smokePath)
  try {
    throws(
      () => raw.exec(`UPDATE trade_rule_evaluations SET rule_id = '${ruleExtra.id}' WHERE rule_id = '${ruleReq.id}'`),
      /fixed/
    )
    throws(() => raw.exec('DELETE FROM trade_rule_evaluations'), /cannot be deleted/)
  } finally {
    raw.close()
  }
})

check('C a rule from another version cannot be evaluated on this trade (composite FK)', () => {
  // Build a second strategy version with its own rule, then try to evaluate it against `trade`.
  const other = r.strategies.create({ name: 'Other' })
  r.strategyVersions.createDraft(other.id)
  const otherDraft = require_(r.strategyVersions.getDraft(other.id), 'other draft')
  const g = r.strategyVersions.addGroup(otherDraft.id, { name: 'G' })
  const foreignRule = r.strategyVersions.addRule(g.id, { title: 'Foreign', kind: 'REQUIRED' })
  r.strategyVersions.publishDraft(other.id)
  const raw = new DatabaseSync(smokePath)
  try {
    throws(
      () =>
        raw.exec(
          `INSERT INTO trade_rule_evaluations (id, trade_id, strategy_version_id, rule_id, state, evaluated_at, created_at, updated_at)
           VALUES ('bad', '${trade.id}', '${v1.id}', '${foreignRule.id}', 'PASS', 1, 1, 1)`
        ),
      /FOREIGN KEY/
    )
  } finally {
    raw.close()
  }
})

check('C trade / notes: read back with exact decimals and relationships', () => {
  const read = require_(r.trades.getById(trade.id), 'trade')
  equal(read.quantity, '2')
  equal(read.avgEntryPrice, '1.10005')
  equal(read.avgExitPrice, '1.10255')
  equal(read.grossPnl, '500')
  equal(read.commission, '-14')
  equal(read.fees, '-2')
  equal(read.swap, '-1.5')
  equal(read.netPnl, '482.5')
  equal(read.plannedR, '1.5')
  equal(read.realizedR, '2.25')
  equal(read.sourcePlatform, 'mt5', 'source platform comes from the account')
  equal(read.accountId, account.id)

  const tradeNote = r.notes.upsertTradeNote(trade.id, 'Held through the pullback.')
  r.notes.upsertTradeNote(trade.id, 'Held through the pullback. Edited.')
  equal(r.notes.getTradeNote(trade.id)?.body, 'Held through the pullback. Edited.')
  equal(r.notes.getTradeNote(trade.id)?.createdAt, tradeNote.createdAt, 'createdAt preserved on upsert')

  r.notes.upsertDayNote(account.id, '2026-03-02', 'Calm session.')
  equal(r.notes.getDayNote(account.id, '2026-03-02')?.body, 'Calm session.')
  equal(r.notes.getDayNote(account.id, '2026-03-03'), null)
  throws(() => r.notes.upsertDayNote(account.id, '03/02/2026', 'x'), /Invalid trade date/)

  equal(r.trades.list({ accountId: account.id, fromDate: '2026-03-02', toDate: '2026-03-02' }).length, 1)
  equal(r.trades.list({ accountId: account.id, fromDate: '2026-03-03' }).length, 0)
  equal(r.accounts.findBySource('mt5', '12345678')?.id, account.id)
})

check('C net P&L convention violations are rejected', () => {
  throws(
    () =>
      r.trades.createTrade({
        accountId: account.id,
        analyticalTradeDate: '2026-03-02',
        instrument: 'EURUSD',
        direction: 'LONG',
        quantity: '1',
        openedAt: 1,
        avgEntryPrice: '1',
        grossPnl: '10',
        commission: '-1',
        netPnl: '10',
        executions: [{ executedAt: 1, side: 'BUY', quantity: '1', price: '1' }]
      }),
    /netPnl must equal/
  )
})

// ---- D. historical integrity -----------------------------------------------
const definitionV1Before = JSON.stringify(r.strategyVersions.getDefinition(v1.id))
const evaluationsV1Before = JSON.stringify(r.evaluations.listForTrade(trade.id))

// v2: heavy edits — rename a rule, retype another, add one, remove one, rename a group.
r.strategyVersions.createDraft(strategy.id)
const draft2 = require_(r.strategyVersions.getDraft(strategy.id), 'draft 2')
const def2 = r.strategyVersions.getDefinition(draft2.id)
const d2Req = require_(def2.groups[0]?.rules.find((x) => x.title === 'Rule required'), 'draft rule')
const d2Extra = require_(def2.groups[1]?.rules.find((x) => x.title === 'Rule extra'), 'draft extra')
r.strategyVersions.updateRule(d2Req.id, { title: 'Rule required (reworded)', kind: 'OPTIONAL' })
r.strategyVersions.removeRule(d2Extra.id)
r.strategyVersions.addRule(def2.groups[0]!.id, { title: 'Brand new rule', kind: 'REQUIRED' })
r.strategyVersions.updateGroup(def2.groups[0]!.id, { name: 'Group A renamed' })
const v2 = r.strategyVersions.publishDraft(strategy.id)

r.strategyVersions.createDraft(strategy.id)
r.strategyVersions.addGroup(require_(r.strategyVersions.getDraft(strategy.id), 'draft 3').id, { name: 'v3 only' })
const v3 = r.strategyVersions.publishDraft(strategy.id)
r.strategies.updateMetadata(strategy.id, { name: 'Smoke Strategy (renamed)' })
r.strategies.setArchived(strategy.id, true)

check('D publishing v2/v3 (and renaming/archiving the strategy) leaves the trade on v1', () => {
  equal([v2.versionNumber, v3.versionNumber], [2, 3])
  equal(v2.baseVersionId, v1.id, 'v2 lineage')
  equal(v3.baseVersionId, v2.id, 'v3 lineage')
  equal(require_(r.trades.getById(trade.id), 'trade').strategyVersionId, v1.id)
  equal(r.strategyVersions.listPublished(strategy.id).map((v) => v.versionNumber), [1, 2, 3])
})

check('D v1 definition and the trade evaluations are byte-for-byte unchanged', () => {
  equal(JSON.stringify(r.strategyVersions.getDefinition(v1.id)), definitionV1Before, 'v1 definition')
  equal(JSON.stringify(r.evaluations.listForTrade(trade.id)), evaluationsV1Before, 'v1 evaluations')
  equal(stateByTitle(trade.id), {
    'Rule required': 'PASS',
    'Rule optional': 'FAIL',
    'Rule conditional': 'N/A',
    'Rule extra': 'UNREVIEWED'
  })
})

check('D v2 really differs (the edits happened, in v2 only)', () => {
  const titles = r.strategyVersions
    .getDefinition(v2.id)
    .groups.flatMap((g) => g.rules.map((x) => x.title))
    .sort()
  equal(titles, ['Brand new rule', 'Rule conditional', 'Rule optional', 'Rule required (reworded)'])
  equal(r.strategyVersions.getDefinition(v2.id).groups[0]?.name, 'Group A renamed')
  equal(r.strategyVersions.getDefinition(v1.id).groups[0]?.name, 'Group A')
})

check('D a trade cannot be re-pointed to another version or to a draft', () => {
  throws(() => r.trades.associateStrategyVersion(trade.id, v3.id), /already associated/)
  const raw = new DatabaseSync(smokePath)
  try {
    throws(
      () => raw.exec(`UPDATE trades SET strategy_version_id = '${v3.id}' WHERE id = '${trade.id}'`),
      /cannot be changed/
    )
  } finally {
    raw.close()
  }
  const draftOnly = r.strategies.create({ name: 'Draft only' })
  const dv = r.strategyVersions.createDraft(draftOnly.id)
  const fresh = r.trades.createTrade({
    accountId: account.id,
    analyticalTradeDate: '2026-03-04',
    instrument: 'EURUSD',
    direction: 'LONG',
    quantity: '1',
    openedAt: 1,
    avgEntryPrice: '1',
    executions: [{ executedAt: 1, side: 'BUY', quantity: '1', price: '1' }]
  })
  throws(() => r.trades.associateStrategyVersion(fresh.id, dv.id), /published/)
})

check('D archived strategy keeps versions, rules, trade and evaluations', () => {
  equal(r.strategies.getById(strategy.id)?.status, 'ARCHIVED')
  equal(r.strategies.list().some((s) => s.id === strategy.id), false, 'hidden from active list')
  equal(r.strategies.list({ includeArchived: true }).some((s) => s.id === strategy.id), true)
  equal(r.strategyVersions.listPublished(strategy.id).length, 3)
  equal(r.evaluations.listForTrade(trade.id).length, 4)
  r.strategies.setArchived(strategy.id, false)
  equal(r.strategies.getById(strategy.id)?.archivedAt, null)
})

check('D no destructive path: strategies/trades/accounts with history cannot be deleted', () => {
  const raw = new DatabaseSync(smokePath)
  try {
    throws(() => raw.exec(`DELETE FROM strategies WHERE id = '${strategy.id}'`), /FOREIGN KEY/)
    throws(() => raw.exec(`DELETE FROM trades WHERE id = '${trade.id}'`), /FOREIGN KEY/)
    throws(() => raw.exec(`DELETE FROM accounts WHERE id = '${account.id}'`), /FOREIGN KEY/)
  } finally {
    raw.close()
  }
})

check('D discarding a draft is safe and leaves history alone', () => {
  r.strategyVersions.createDraft(strategy.id)
  r.strategyVersions.discardDraft(strategy.id)
  equal(r.strategyVersions.getDraft(strategy.id), null)
  equal(r.strategyVersions.listPublished(strategy.id).length, 3)
})

// ---- Trade <-> Strategy Version association lifecycle -----------------------
check('ASSOC null -> published v1 succeeds; evaluations for v1; v2 publish leaves trade on v1', () => {
  const s = r.strategies.create({ name: 'Lifecycle' })
  r.strategyVersions.createDraft(s.id)
  const dr = require_(r.strategyVersions.getDraft(s.id), 'lifecycle draft')
  const g = r.strategyVersions.addGroup(dr.id, { name: 'G' })
  const ra = r.strategyVersions.addRule(g.id, { title: 'Rule A', kind: 'REQUIRED' })
  const rb = r.strategyVersions.addRule(g.id, { title: 'Rule B', kind: 'OPTIONAL' })
  const lv1 = r.strategyVersions.publishDraft(s.id)

  // 1. imported with no strategy version
  const t = r.trades.createTrade({
    accountId: account.id,
    analyticalTradeDate: '2026-04-01',
    instrument: 'ES',
    direction: 'LONG',
    quantity: '1',
    openedAt: 1,
    avgEntryPrice: '5000',
    executions: [{ executedAt: 1, side: 'BUY', quantity: '1', price: '5000' }]
  })
  equal(t.strategyVersionId, null, 'starts unassociated')
  equal(r.evaluations.listForTrade(t.id).length, 0, 'no evaluations before association')

  // 2-3. explicit later assignment of published v1
  const assigned = r.trades.associateStrategyVersion(t.id, lv1.id)
  equal(assigned.strategyVersionId, lv1.id)

  // 4. evaluations for v1 (created UNREVIEWED, then judged)
  equal(r.evaluations.listForTrade(t.id).map((e) => e.state), ['UNREVIEWED', 'UNREVIEWED'])
  r.evaluations.setState(t.id, ra.id, 'PASS')
  r.evaluations.setState(t.id, rb.id, 'FAIL')
  const before = JSON.stringify(r.evaluations.listForTrade(t.id))

  // 5. publish v2 (with real edits)
  r.strategyVersions.createDraft(s.id)
  const d2 = require_(r.strategyVersions.getDraft(s.id), 'lifecycle draft 2')
  const g2 = r.strategyVersions.getDefinition(d2.id).groups[0]!
  r.strategyVersions.removeRule(g2.rules[0]!.id)
  r.strategyVersions.addRule(g2.id, { title: 'Rule C', kind: 'REQUIRED' })
  const lv2 = r.strategyVersions.publishDraft(s.id)
  equal(lv2.versionNumber, 2)

  // 6. trade unchanged: same version, same evaluations, all bound to v1
  const after = require_(r.trades.getById(t.id), 'trade')
  equal(after.strategyVersionId, lv1.id, 'still on v1')
  equal(JSON.stringify(r.evaluations.listForTrade(t.id)), before, 'evaluations unchanged')
  equal(r.evaluations.listForTrade(t.id).every((e) => e.strategyVersionId === after.strategyVersionId), true)
  equal(after.updatedAt, assigned.updatedAt, 'publishing did not touch the trade row')
})

check('ASSOC once associated, every re-association or clearing path is refused', () => {
  const s = r.strategies.list({ includeArchived: true }).find((x) => x.name === 'Lifecycle')!
  const [lv1, lv2] = r.strategyVersions.listPublished(s.id)
  const t = r.trades.list({ fromDate: '2026-04-01', toDate: '2026-04-01' })[0]!
  throws(() => r.trades.associateStrategyVersion(t.id, lv2!.id), /already associated/)
  throws(() => r.trades.associateStrategyVersion(t.id, lv1!.id), /already associated/)
  const raw = new DatabaseSync(smokePath)
  try {
    throws(() => raw.exec(`UPDATE trades SET strategy_version_id = '${lv2!.id}' WHERE id = '${t.id}'`), /cannot be changed/)
    throws(() => raw.exec(`UPDATE trades SET strategy_version_id = NULL WHERE id = '${t.id}'`), /cannot be changed/)
  } finally {
    raw.close()
  }
})

// ---- costs: commission / fees / swap ----------------------------------------
check('COST categories are separate, signed, exact, and NULL means not reported', () => {
  const t = r.trades.createTrade({
    accountId: account.id,
    analyticalTradeDate: '2026-04-02',
    instrument: 'NQ',
    direction: 'LONG',
    quantity: '2',
    openedAt: 1,
    avgEntryPrice: '20000.25',
    avgExitPrice: '20010.25',
    grossPnl: '400.00000001',
    commission: '-2.5',
    fees: '-1.23456789',
    swap: '-0.00000001',
    netPnl: '396.26543211',
    executions: [
      { executedAt: 1, side: 'BUY', quantity: '2', price: '20000.25', commission: '-1.25', fees: '-0.5' },
      { executedAt: 2, side: 'SELL', quantity: '2', price: '20010.25' }
    ]
  })
  equal([t.grossPnl, t.commission, t.fees, t.swap, t.netPnl], ['400.00000001', '-2.5', '-1.23456789', '-0.00000001', '396.26543211'])
  const [e1, e2] = r.trades.listExecutions(t.id)
  equal([e1!.commission, e1!.fees, e1!.swap], ['-1.25', '-0.5', null], 'per-execution costs preserved as supplied')
  equal([e2!.commission, e2!.fees, e2!.swap], [null, null, null], 'unsupplied per-execution costs stay NULL, not 0')
})

check('COST trade-level totals only (no per-execution costs) and fee-only trades are representable', () => {
  const t = r.trades.createTrade({
    accountId: account.id,
    analyticalTradeDate: '2026-04-03',
    instrument: 'CL',
    direction: 'SHORT',
    quantity: '1',
    openedAt: 1,
    avgEntryPrice: '70.5',
    grossPnl: '100',
    fees: '-2.5',
    netPnl: '97.5',
    executions: [{ executedAt: 1, side: 'SELL', quantity: '1', price: '70.5' }]
  })
  equal([t.commission, t.fees, t.swap, t.netPnl], [null, '-2.5', null, '97.5'])
  equal(r.trades.listExecutions(t.id).map((e) => [e.commission, e.fees, e.swap]), [[null, null, null]])
})

check('COST net invariant covers every persisted category', () => {
  const base = {
    accountId: account.id,
    analyticalTradeDate: '2026-04-04',
    instrument: 'EURUSD',
    direction: 'LONG' as const,
    quantity: '1',
    openedAt: 1,
    avgEntryPrice: '1',
    grossPnl: '100',
    executions: [{ executedAt: 1, side: 'BUY' as const, quantity: '1', price: '1' }]
  }
  const ok = r.trades.createTrade({ ...base, commission: '-1', fees: '-2', swap: '-3', netPnl: '94' })
  equal(ok.netPnl, '94')
  throws(() => r.trades.createTrade({ ...base, commission: '-1', fees: '-2', swap: '-3', netPnl: '97' }), /netPnl must equal/) // omits swap
  throws(() => r.trades.createTrade({ ...base, commission: '-1', fees: '-2', swap: '-3', netPnl: '96' }), /netPnl must equal/) // omits fees
  throws(() => r.trades.createTrade({ ...base, commission: '-1', fees: '-2', swap: '-3', netPnl: '95' }), /netPnl must equal/) // omits commission
  throws(() => r.trades.createTrade({ ...base, commission: '-1.000000001' }), /fractional digits/)
})

// ---- E. multi-execution LONG ------------------------------------------------
check('E one Trade owns BUY 1, BUY 1, SELL 1, SELL 1 — not four Trades', () => {
  const executions = r.trades.listExecutions(trade.id)
  equal(executions.map((e) => `${e.side} ${e.quantity}`), ['BUY 1', 'BUY 1', 'SELL 1', 'SELL 1'])
  equal(executions.every((e) => e.tradeId === trade.id), true)
  equal(executions.map((e) => e.sourceExecutionId), ['D-1', 'D-2', 'D-3', 'D-4'])
  equal(executions.map((e) => e.price), ['1.1', '1.1001', '1.1025', '1.1026'])
  equal(r.trades.list({ accountId: account.id, fromDate: '2026-03-02', toDate: '2026-03-02' }).length, 1)
  equal(require_(r.trades.getById(trade.id), 'trade').direction, 'LONG')
})

// ---- F. short safety --------------------------------------------------------
check('F SHORT trade (SELL entry, BUY exit) stays SHORT; direction is never derived', () => {
  const short = r.trades.createTrade({
    accountId: account.id,
    analyticalTradeDate: '2026-03-05',
    instrument: 'NQ',
    direction: 'SHORT',
    quantity: '1',
    openedAt: 1_772_500_000_000,
    closedAt: 1_772_500_300_000,
    avgEntryPrice: '20000.25',
    avgExitPrice: '19990',
    grossPnl: '205',
    commission: '-3',
    fees: '-1.5',
    netPnl: '200.5',
    executions: [
      { executedAt: 1_772_500_000_000, side: 'SELL', quantity: '1', price: '20000.25', commission: '-2.25' },
      { executedAt: 1_772_500_300_000, side: 'BUY', quantity: '1', price: '19990', commission: '-2.25' }
    ]
  })
  const read = require_(r.trades.getById(short.id), 'short trade')
  equal(read.direction, 'SHORT')
  equal(r.trades.listExecutions(short.id).map((e) => e.side), ['SELL', 'BUY'])
  equal(read.avgEntryPrice, '20000.25')
  equal(read.netPnl, '200.5')
})

// ---- source-id dedup and atomicity ------------------------------------------
check('dedup: same source execution cannot be ingested twice; failed trade rolls back entirely', () => {
  const before = r.trades.list().length
  throws(
    () =>
      r.trades.createTrade({
        accountId: account.id,
        analyticalTradeDate: '2026-03-06',
        instrument: 'EURUSD',
        direction: 'LONG',
        quantity: '1',
        openedAt: 1,
        avgEntryPrice: '1',
        executions: [
          { executedAt: 1, side: 'BUY', quantity: '1', price: '1', sourceExecutionId: 'NEW-1' },
          { executedAt: 2, side: 'SELL', quantity: '1', price: '1', sourceExecutionId: 'D-1' }
        ]
      }),
    /UNIQUE/
  )
  equal(r.trades.list().length, before, 'trade row rolled back with its executions')
})

check('dedup: executions without source ids are not deduplicated; ids are not invented', () => {
  const make = (): void => {
    r.trades.createTrade({
      accountId: account.id,
      analyticalTradeDate: '2026-03-07',
      instrument: 'EURUSD',
      direction: 'LONG',
      quantity: '1',
      openedAt: 1,
      avgEntryPrice: '1',
      executions: [{ executedAt: 1, side: 'BUY', quantity: '1', price: '1' }]
    })
  }
  make()
  make()
  const nulls = r.trades
    .list({ fromDate: '2026-03-07', toDate: '2026-03-07' })
    .flatMap((t) => r.trades.listExecutions(t.id))
  equal(nulls.map((e) => e.sourceExecutionId), [null, null])
})

check('executions are immutable (repository has no edit path; schema triggers block raw edits)', () => {
  const raw = new DatabaseSync(smokePath)
  try {
    throws(() => raw.exec(`UPDATE executions SET price = 1 WHERE source_execution_id = 'D-1'`), /immutable/)
    throws(() => raw.exec(`DELETE FROM executions WHERE source_execution_id = 'D-1'`), /cannot be deleted/)
  } finally {
    raw.close()
  }
})

check('accounts: duplicate source identity rejected; archive is not delete', () => {
  throws(
    () =>
      r.accounts.create({
        displayName: 'Dup',
        sourcePlatform: 'mt5',
        sourceAccountId: '12345678',
        currency: 'USD'
      }),
    /UNIQUE/
  )
  const other = r.accounts.create({ displayName: 'Other', sourcePlatform: 'tradovate', currency: 'USD' })
  r.accounts.setArchived(other.id, true)
  equal(r.accounts.list().some((a) => a.id === other.id), false)
  equal(r.accounts.list({ includeArchived: true }).some((a) => a.id === other.id), true)
})

// ---- G(part). persistence across close / reopen ----------------------------
db.close()
{
  const reopened = Database.open(smokePath)
  check('G reopen: everything above survives close/reopen; no migration re-run', () => {
    equal(reopened.health.migrationsAppliedThisOpen, [])
    const t = require_(reopened.repositories.trades.getById(trade.id), 'trade after reopen')
    equal([t.strategyVersionId, t.direction, t.netPnl], [v1.id, 'LONG', '482.5'])
    equal(reopened.repositories.trades.listExecutions(trade.id).length, 4)
    equal(reopened.repositories.strategyVersions.listPublished(strategy.id).length, 3)
    equal(reopened.repositories.notes.getTradeNote(trade.id)?.body, 'Held through the pullback. Edited.')
    equal(
      reopened.repositories.evaluations.listForTrade(trade.id).map((e) => e.state),
      ['PASS', 'FAIL', 'N/A', 'UNREVIEWED']
    )
  })
  reopened.close()
}

// ===========================================================================
// 011B-1: Strategy service + IPC handlers (persistence across restarts)
// ===========================================================================
const strategyDbPath = newDbPath()

interface Session {
  db: Database
  svc: StrategyService
  call: (channel: keyof typeof STRATEGY_CHANNELS, payload?: unknown) => IpcResult<unknown>
}

/** Opens the database like an app start: new connection, new service, new handlers. */
function startSession(path: string): Session {
  const db = Database.open(path)
  const svc = new StrategyService(db)
  const handlers = createStrategyHandlers({ getService: () => svc, log: () => undefined })
  return {
    db,
    svc,
    call: (channel, payload) => (handlers[STRATEGY_CHANNELS[channel]] as StrategyHandler)(payload)
  }
}

function ok<T>(result: IpcResult<unknown>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.data as T
}

function fail(result: IpcResult<unknown>, code: string, pattern?: RegExp): void {
  if (result.ok) throw new Error(`expected ${code}, but the call succeeded`)
  if (result.error.code !== code) throw new Error(`expected ${code}, got ${result.error.code}: ${result.error.message}`)
  if (pattern && !pattern.test(result.error.message)) throw new Error(`message "${result.error.message}" !~ ${pattern}`)
}

const named = (list: StrategyDto[], name: string): StrategyDto =>
  require_(list.find((x) => x.name === name), `strategy ${name}`)
const flatNames = (groups: { rules: { name: string }[] }[]): string[] => groups.flatMap((g) => g.rules.map((x) => x.name))

let session = startSession(strategyDbPath)
let v3Snapshot = ''
let v1v2Snapshot = ''
let betaV1Snapshot = ''

check('I dev seed: seeds an empty DB once, is idempotent, and seeds no trading history', () => {
  equal(seedDevelopmentStrategies(session.db), true, 'first seed')
  equal(seedDevelopmentStrategies(session.db), false, 'second seed is a no-op')
  const list = ok<StrategyDto[]>(session.call('list'))
  equal(list.map((x) => x.name), ['Strategy Alpha', 'Strategy Beta', 'Strategy Gamma'])
  equal(list.map((x) => x.versions.length), [3, 1, 1])
  equal(list.map((x) => x.status), ['Active', 'Active', 'Archived'])
  equal(list.every((x) => x.draft === null), true, 'seed leaves no drafts')
  equal(session.db.repositories.trades.list().length, 0, 'no trades seeded')
  equal(session.db.repositories.accounts.list({ includeArchived: true }).length, 0, 'no accounts seeded')
  v3Snapshot = JSON.stringify(named(list, 'Strategy Alpha').versions[2])
  v1v2Snapshot = JSON.stringify(named(list, 'Strategy Alpha').versions.slice(0, 2))
  betaV1Snapshot = JSON.stringify(named(list, 'Strategy Beta').versions[0])
})

session.db.close()
session = startSession(strategyDbPath)

check('I dev seed: a restart does not duplicate Strategy Alpha', () => {
  equal(seedDevelopmentStrategies(session.db), false)
  equal(ok<StrategyDto[]>(session.call('list')).filter((x) => x.name === 'Strategy Alpha').length, 1)
})

check('A metadata edit persists across restart and creates no Draft or Version', () => {
  const alpha = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  const updated = ok<StrategyDto>(
    session.call('updateDetails', { strategyId: alpha.id, name: 'Strategy Alpha', description: 'Edited description' })
  )
  equal(updated.description, 'Edited description')
  equal([updated.draft, updated.versions.length], [null, 3])
  session.db.close()
  session = startSession(strategyDbPath)
  const after = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  equal(after.description, 'Edited description')
  equal([after.draft, after.versions.length], [null, 3])
  equal(JSON.stringify(after.versions[2]), v3Snapshot, 'v3 untouched by metadata edit')
})

check('C/D unpublished Draft with rule edits, kinds and ordering survives restart', () => {
  const alpha = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  const begun = ok<StrategyDto>(session.call('beginDraft', alpha.id))
  equal(begun.draft?.basedOn, 3)
  equal(flatNames(begun.draft!.groups), ['Rule A', 'Rule B', 'Rule C', 'Rule D', 'Rule E'])
  const edit = (e: DraftEdit): StrategyDto => ok<StrategyDto>(session.call('editDraft', { strategyId: alpha.id, edit: e }))
  const ruleB = begun.draft!.groups[0]!.rules.find((x) => x.name === 'Rule B')!
  edit({ type: 'updateRule', ruleId: ruleB.id, name: 'Rule B', kind: 'Optional', description: 'Rule B — edited in draft' })
  const groupB = begun.draft!.groups[1]!
  const withF = edit({ type: 'addRule', groupId: groupB.id, name: 'Rule F', kind: 'Conditional', description: 'Rule F' })
  const ruleF = withF.draft!.groups[1]!.rules.find((x) => x.name === 'Rule F')!
  edit({ type: 'moveRule', ruleId: ruleF.id, delta: -1 })
  edit({ type: 'moveGroup', groupId: groupB.id, delta: -1 })
  const before = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  equal(before.draft!.groups.map((g) => g.name), ['Group B', 'Group A'])
  equal(before.draft!.groups[0]!.rules.map((x) => x.name), ['Rule D', 'Rule F', 'Rule E'])

  session.db.close()
  session = startSession(strategyDbPath)
  const after = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  equal(after.draft?.basedOn, 3, 'still based on v3')
  equal(after.draft!.groups.map((g) => g.name), ['Group B', 'Group A'], 'group order')
  equal(after.draft!.groups[0]!.rules.map((x) => x.name), ['Rule D', 'Rule F', 'Rule E'], 'rule order')
  const b = after.draft!.groups[1]!.rules.find((x) => x.name === 'Rule B')!
  equal([b.kind, b.description], ['Optional', 'Rule B — edited in draft'])
  equal(after.draft!.groups[0]!.rules.find((x) => x.name === 'Rule F')!.kind, 'Conditional')
  equal(after.versions.length, 3)
  equal(JSON.stringify(after.versions[2]), v3Snapshot, 'published v3 unchanged by draft edits')
  equal(JSON.stringify(after.versions.slice(0, 2)), v1v2Snapshot, 'v1/v2 unchanged')
})

check('one Draft per strategy: a second beginDraft is refused', () => {
  const alpha = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  fail(session.call('beginDraft', alpha.id), 'CONFLICT', /already has a draft/)
})

check('draft edits only honour ids from THIS strategy\'s draft', () => {
  const list = ok<StrategyDto[]>(session.call('list'))
  const alpha = named(list, 'Strategy Alpha')
  const betaId = named(list, 'Strategy Beta').id
  ok(session.call('beginDraft', betaId))
  const beta = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta')
  const alphaGroup = alpha.draft!.groups[0]!.id
  fail(
    session.call('editDraft', { strategyId: beta.id, edit: { type: 'renameGroup', groupId: alphaGroup, name: 'hijack' } }),
    'NOT_FOUND'
  )
  ok(session.call('discardDraft', beta.id))
})

check('F publish creates the next sequential version; G older versions unchanged; draft consumed', () => {
  const alpha = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  const published = ok<StrategyDto>(session.call('publishDraft', alpha.id))
  equal(published.versions.map((v) => v.number), [1, 2, 3, 4])
  equal(published.draft, null)
  equal(JSON.stringify(published.versions[2]), v3Snapshot, 'v3 unchanged in the publish response')
  equal(flatNames(published.versions[3]!.groups), ['Rule D', 'Rule F', 'Rule E', 'Rule A', 'Rule B', 'Rule C'])
  equal(published.versions[3]!.changes.includes('+ Rule F'), true, 'change summary mentions the added rule')
  equal(published.versions[3]!.changes.includes('Rule B updated'), true)

  session.db.close()
  session = startSession(strategyDbPath)
  const after = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  equal(after.versions.map((v) => v.number), [1, 2, 3, 4], 'versions after restart')
  equal(after.draft, null)
  equal(JSON.stringify(after.versions[2]), v3Snapshot, 'v3 unchanged after restart')
  equal(JSON.stringify(after.versions.slice(0, 2)), v1v2Snapshot, 'v1/v2 unchanged after restart')
  equal(JSON.stringify(after.versions[3]), JSON.stringify(published.versions[3]), 'v4 identical after restart')
})

check('publish is blocked (and changes nothing) when the draft has no changes', () => {
  const alpha = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  ok(session.call('beginDraft', alpha.id))
  fail(session.call('publishDraft', alpha.id), 'RULE_VIOLATION', /No rule changes from v4/)
  const still = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  equal([still.versions.length, still.draft?.basedOn], [4, 4], 'no half-published version')
  ok(session.call('discardDraft', alpha.id))
})

check('publish is atomic: a failure after the flip rolls the whole publish back', () => {
  const alpha = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  ok(session.call('beginDraft', alpha.id))
  const draft = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha').draft!
  ok(session.call('editDraft', { strategyId: alpha.id, edit: { type: 'addRule', groupId: draft.groups[0]!.id, name: 'Rule G', kind: 'Required', description: '' } }))
  throws(
    () =>
      session.db.transaction(() => {
        session.svc.publishDraft(alpha.id)
        throw new Error('simulated failure after publish')
      }),
    /simulated failure/
  )
  const after = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  equal(after.versions.map((v) => v.number), [1, 2, 3, 4], 'no v5 left behind')
  equal(flatNames(after.draft!.groups).includes('Rule G'), true, 'draft intact')
  ok(session.call('discardDraft', alpha.id))
})

check('E discard removes only the Draft and persists across restart', () => {
  const list = ok<StrategyDto[]>(session.call('list'))
  const beta = named(list, 'Strategy Beta')
  ok(session.call('beginDraft', beta.id))
  const g = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta').draft!.groups[0]!
  ok(session.call('editDraft', { strategyId: beta.id, edit: { type: 'deleteGroup', groupId: g.id } }))
  session.db.close()
  session = startSession(strategyDbPath)
  const mid = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta')
  equal(mid.draft!.groups.length, 2, 'draft edit survived restart')
  const discarded = ok<StrategyDto>(session.call('discardDraft', beta.id))
  equal(discarded.draft, null)
  session.db.close()
  session = startSession(strategyDbPath)
  const after = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta')
  equal(after.draft, null)
  equal(JSON.stringify(after.versions[0]), betaV1Snapshot, 'Beta v1 unchanged')
  equal(after.versions.length, 1)
})

check('B new strategy: initial Draft (no fabricated v1) survives restart; first publish makes v1', () => {
  const created = ok<StrategyDto>(session.call('create', { name: 'Strategy Delta', description: 'new' }))
  equal([created.versions.length, created.draft?.basedOn, created.status], [0, null, 'Active'])
  const edit = (e: DraftEdit): StrategyDto => ok<StrategyDto>(session.call('editDraft', { strategyId: created.id, edit: e }))
  const withGroup = edit({ type: 'addGroup', name: 'Group X' })
  const gid = withGroup.draft!.groups[0]!.id
  edit({ type: 'addRule', groupId: gid, name: 'Rule 1', kind: 'Required', description: 'first' })
  edit({ type: 'addRule', groupId: gid, name: 'Rule 2', kind: 'Optional', description: '' })
  fail(session.call('discardDraft', created.id), 'RULE_VIOLATION', /delete it/)
  fail(session.call('archive', created.id), 'RULE_VIOLATION')

  session.db.close()
  session = startSession(strategyDbPath)
  const after = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Delta')
  equal([after.versions.length, after.draft?.basedOn], [0, null], 'no version before publish')
  equal(flatNames(after.draft!.groups), ['Rule 1', 'Rule 2'])

  const published = ok<StrategyDto>(session.call('publishDraft', after.id))
  equal(published.versions.map((v) => v.number), [1])
  equal(published.versions[0]!.changes, ['Initial version'])
  equal(published.draft, null)
})

check('publish of an empty first draft is refused', () => {
  const created = ok<StrategyDto>(session.call('create', { name: 'Strategy Empty', description: '' }))
  fail(session.call('publishDraft', created.id), 'RULE_VIOLATION', /at least one rule/)
  ok(session.call('editDraft', { strategyId: created.id, edit: { type: 'addGroup', name: 'Only group' } }))
  fail(session.call('publishDraft', created.id), 'RULE_VIOLATION', /at least one rule/)
})

check('delete: only a never-published strategy; persists across restart', () => {
  const list = ok<StrategyDto[]>(session.call('list'))
  const empty = named(list, 'Strategy Empty')
  fail(session.call('deleteUnpublished', named(list, 'Strategy Alpha').id), 'RULE_VIOLATION', /archive/)
  ok(session.call('deleteUnpublished', empty.id))
  session.db.close()
  session = startSession(strategyDbPath)
  equal(ok<StrategyDto[]>(session.call('list')).some((x) => x.name === 'Strategy Empty'), false)
  fail(session.call('deleteUnpublished', 'no-such-id'), 'NOT_FOUND')
})

check('H archive / restore persist across restart; archived is read-only; history retained', () => {
  const beta = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta')
  equal(ok<StrategyDto>(session.call('archive', beta.id)).status, 'Archived')
  session.db.close()
  session = startSession(strategyDbPath)
  const archived = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta')
  equal([archived.status, archived.versions.length], ['Archived', 1])
  equal(JSON.stringify(archived.versions[0]), betaV1Snapshot, 'history retained')
  fail(session.call('beginDraft', beta.id), 'RULE_VIOLATION', /archived/)
  fail(session.call('updateDetails', { strategyId: beta.id, name: 'Strategy Beta', description: 'x' }), 'RULE_VIOLATION', /archived/)
  equal(ok<StrategyDto>(session.call('restore', beta.id)).status, 'Active')
  session.db.close()
  session = startSession(strategyDbPath)
  equal(named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta').status, 'Active')
})

check('archive is refused while a draft is open', () => {
  const beta = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta')
  ok(session.call('beginDraft', beta.id))
  fail(session.call('archive', beta.id), 'RULE_VIOLATION', /draft/)
  ok(session.call('discardDraft', beta.id))
})

check('duplicate strategy names (case-insensitive) are refused on create and rename', () => {
  fail(session.call('create', { name: '  strategy ALPHA ', description: '' }), 'CONFLICT', /already exists/)
  const beta = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Beta')
  fail(session.call('updateDetails', { strategyId: beta.id, name: 'strategy alpha', description: '' }), 'CONFLICT')
})

check('published versions stay immutable: the database still refuses direct edits', () => {
  const alpha = named(ok<StrategyDto[]>(session.call('list')), 'Strategy Alpha')
  const rule = alpha.versions[3]!.groups[0]!.rules[0]!
  const raw = new DatabaseSync(strategyDbPath)
  try {
    throws(() => raw.exec(`UPDATE rules SET title = 'x' WHERE id = '${rule.id}'`), /immutable/)
  } finally {
    raw.close()
  }
})

check('IPC validation: malformed, oversized and unknown payloads become INVALID_INPUT, never exceptions', () => {
  fail(session.call('archive', 42), 'INVALID_INPUT')
  fail(session.call('create', null), 'INVALID_INPUT')
  fail(session.call('create', { name: '   ', description: '' }), 'INVALID_INPUT', /required/)
  fail(session.call('create', { name: 'x'.repeat(500), description: '' }), 'INVALID_INPUT', /too long/)
  fail(session.call('create', { name: 'ok', description: 5 }), 'INVALID_INPUT')
  fail(session.call('editDraft', { strategyId: 'a', edit: { type: 'dropTables' } }), 'INVALID_INPUT', /Unknown draft edit/)
  fail(session.call('editDraft', { strategyId: 'a', edit: { type: 'moveRule', ruleId: 'r', delta: 5 } }), 'INVALID_INPUT')
  fail(
    session.call('editDraft', { strategyId: 'a', edit: { type: 'addRule', groupId: 'g', name: 'r', kind: 'Mandatory', description: '' } }),
    'INVALID_INPUT',
    /kind/
  )
  fail(session.call('editDraft', 'SELECT * FROM rules'), 'INVALID_INPUT')
})

check('IPC results are plain serializable data (no BigInt, no class instances)', () => {
  const result = session.call('list')
  const roundTripped = JSON.parse(JSON.stringify(result)) as unknown
  equal(roundTripped, result as unknown)
  const text = JSON.stringify(result)
  equal(/"(publishedAt|number)":\d+/.test(text), true)
})

check('J persistence unavailable: every channel reports PERSISTENCE_UNAVAILABLE (no silent empty data)', () => {
  const handlers = createStrategyHandlers({ getService: () => null, log: () => undefined })
  for (const channel of Object.values(STRATEGY_CHANNELS)) {
    const result = handlers[channel]({ strategyId: 'x', name: 'n', description: '' })
    equal(result.ok, false, channel)
    if (result.ok) throw new Error('unreachable')
    equal(result.error.code, 'PERSISTENCE_UNAVAILABLE', channel)
  }
})

check('unexpected failures are logged and returned as a generic INTERNAL error (no internals leaked)', () => {
  let logged = 0
  const broken = { list: () => { throw new Error('sqlite secret path C:/x') } } as unknown as StrategyService
  const handlers = createStrategyHandlers({ getService: () => broken, log: () => { logged += 1 } })
  const result = handlers[STRATEGY_CHANNELS.list](undefined)
  fail(result, 'INTERNAL')
  equal(/secret|sqlite/.test(JSON.stringify(result)), false, 'no leak')
  equal(logged, 1)
})

session.db.close()

// ---- Checkpoint 011B-2: trading application / IPC layer ---------------------
runTradingSmoke({ check, equal, throws, newDbPath, makeClock })

// ---- Checkpoint 012B-3: active account ----
runAccountsSmoke({ check, equal, throws, newDbPath, makeClock })

rmSync(workDir, { recursive: true, force: true })
log(`\n${passed} passed, ${failed} failed`)
app.exit(failed === 0 ? 0 : 1)
