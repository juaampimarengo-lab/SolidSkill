import type { Database, NewTrade } from '../persistence'
import { SEED_DAY_NOTES, SEED_TRADES } from './devSeedData'
import type { SeedTrade } from './devSeedData'

/**
 * DEVELOPMENT-ONLY demo trading data. Never called for a packaged app (see
 * src/main/index.ts), never part of normal repository behaviour.
 *
 * Policy (docs/PERSISTENCE.md "Development trading seed"):
 *  - runs only when the app is not packaged (and SOLID_SKILL_DEV_SEED != '0'),
 *    into the separate solid-skill-dev userData database — never the
 *    production-named one;
 *  - idempotent: the single development Account is identified by its source
 *    identity (platform 'dev-fixture'); if it exists nothing is written again,
 *    so restarts never duplicate accounts, trades, executions, notes or
 *    evaluations;
 *  - atomic: one transaction, so it either seeds completely or not at all;
 *  - goes through the real repositories, so seeded trades obey every schema
 *    rule (exact version association, evaluation coordinates, immutability);
 *  - source identifiers are plainly fake ('dev-fixture:…') and cannot be
 *    mistaken for MT5/Tradovate identifiers; there are no credentials.
 *
 * Strategy NAMES are used here, once, only to locate the seeded demo
 * strategies (Alpha/Beta) and their published versions while creating the
 * rows. The stored relationship is the persisted Strategy Version id; nothing
 * at runtime ever matches a trade to a strategy by name.
 */

export const DEV_PLATFORM = 'dev-fixture'
export const DEV_ACCOUNT_SOURCE_ID = 'dev-fixture-account-1'
const DEV_ACCOUNT = {
  displayName: 'Demo Account 50K',
  sourcePlatform: DEV_PLATFORM,
  sourceAccountId: DEV_ACCOUNT_SOURCE_ID,
  currency: 'USD',
  timezone: 'America/New_York'
}

/**
 * Fixture wall-clock times are New York exchange time. Every fixture date
 * (Aug–Sep 2026) is inside US daylight time, i.e. UTC-4.
 */
const DEV_UTC_OFFSET_HOURS = -4

function wallClockToEpoch(date: string, time: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const [h, mi, s] = time.split(':').map(Number) as [number, number, number]
  return Date.UTC(y, mo - 1, d, h - DEV_UTC_OFFSET_HOURS, mi, s)
}

export type TradingSeedResult =
  | { status: 'seeded'; trades: number }
  | { status: 'already-seeded' }
  | { status: 'skipped'; reason: string }

interface ResolvedTrade {
  seed: SeedTrade
  versionId: string
  ruleIds: Map<string, string>
}

/** Seeds the demo Account, Trades, Executions, Rule Evaluations and notes if (and only if) the dev Account is absent. */
export function seedDevelopmentTrading(db: Database): TradingSeedResult {
  const { accounts, strategies, strategyVersions, trades, notes, evaluations } = db.repositories
  return db.transaction((): TradingSeedResult => {
    if (accounts.findBySource(DEV_PLATFORM, DEV_ACCOUNT_SOURCE_ID) !== null) return { status: 'already-seeded' }

    // Resolve every referenced Strategy Version and rule up front, so a
    // missing/renamed demo strategy skips the whole seed instead of half-seeding.
    const byName = new Map(strategies.list({ includeArchived: true }).map((s) => [s.name, s]))
    const resolved: ResolvedTrade[] = []
    for (const seed of SEED_TRADES) {
      const strategy = byName.get(seed.strategy)
      if (strategy === undefined) return { status: 'skipped', reason: `demo strategy "${seed.strategy}" not found` }
      const version = strategyVersions.listPublished(strategy.id).find((v) => v.versionNumber === seed.version)
      if (version === undefined) {
        return { status: 'skipped', reason: `demo strategy "${seed.strategy}" has no published v${seed.version}` }
      }
      const ruleIds = new Map(strategyVersions.listRules(version.id).map((r) => [r.title, r.id]))
      for (const name of Object.keys(seed.rules)) {
        if (!ruleIds.has(name)) {
          return { status: 'skipped', reason: `"${seed.strategy}" v${seed.version} has no rule "${name}"` }
        }
      }
      resolved.push({ seed, versionId: version.id, ruleIds })
    }

    const account = accounts.create(DEV_ACCOUNT)

    for (const { seed, versionId, ruleIds } of resolved) {
      const executions = seed.executions.map((e, i) => ({
        sourceExecutionId: `${DEV_PLATFORM}:${seed.key}:${i + 1}`,
        executedAt: wallClockToEpoch(seed.date, e.time),
        side: e.side,
        quantity: e.quantity,
        price: e.price,
        commission: e.commission
      }))
      const input: NewTrade = {
        accountId: account.id,
        sourceTradeId: `${DEV_PLATFORM}:${seed.key}`,
        analyticalTradeDate: seed.date,
        instrument: seed.instrument,
        // Explicit fact from the fixture; never derived from the execution sides.
        direction: seed.direction,
        quantity: seed.quantity,
        openedAt: executions[0]!.executedAt,
        closedAt: executions[executions.length - 1]!.executedAt,
        avgEntryPrice: seed.avgEntry,
        avgExitPrice: seed.avgExit,
        grossPnl: seed.gross,
        commission: seed.commission,
        netPnl: seed.net,
        plannedR: seed.plannedR,
        realizedR: seed.realizedR,
        executions
      }
      const trade = trades.createTrade(input)
      trades.associateStrategyVersion(trade.id, versionId)
      for (const [ruleName, state] of Object.entries(seed.rules)) {
        if (state === 'Unreviewed') continue // associateStrategyVersion already created it UNREVIEWED
        evaluations.setState(
          trade.id,
          ruleIds.get(ruleName) as string,
          state === 'Pass' ? 'PASS' : state === 'Fail' ? 'FAIL' : 'N/A'
        )
      }
      notes.upsertTradeNote(trade.id, seed.tradeNote)
    }
    for (const [date, body] of Object.entries(SEED_DAY_NOTES)) notes.upsertDayNote(account.id, date, body)

    return { status: 'seeded', trades: resolved.length }
  })
}
