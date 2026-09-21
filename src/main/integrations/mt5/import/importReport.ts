/**
 * Development report over persisted MT5 accounts: counts and aggregates only,
 * masked identity, read-only (repositories + the Trading read model). Never
 * prints a login, server, ticket, or per-trade history.
 */
import type { Database } from '../../../persistence'
import { decimalToScaled, scaledToDecimal } from '../../../persistence/fixedPoint'
import { TradingService } from '../../../trading/tradingService'
import { MT5_PLATFORM, maskLogin } from './mt5ImportService'

export const sumDecimals = (values: readonly (string | null)[]): string | null => {
  let total: bigint | null = null
  for (const v of values) if (v !== null) total = (total ?? 0n) + decimalToScaled(v)
  return total === null ? null : scaledToDecimal(total)
}

function maskedLoginOf(sourceAccountId: string | null): string {
  try {
    const parsed = JSON.parse(sourceAccountId ?? '[]') as string[]
    return maskLogin(parsed[1] ?? '')
  } catch {
    return '***'
  }
}

/**
 * @param accountMask optional masked identity (e.g. "***514") choosing which persisted MT5 account to summarize.
 */
export function buildPersistedReport(db: Database, accountMask?: string): string[] {
  const { accounts, trades, evaluations, notes } = db.repositories
  const list = new TradingService(db).list()
  const mt5 = accounts
    .list({ includeArchived: true })
    .filter((a) => a.sourcePlatform === MT5_PLATFORM)
    .filter((a) => accountMask === undefined || maskedLoginOf(a.sourceAccountId) === accountMask)
  const out: string[] = [`Persisted accounts: ${list.accounts.length} total; ${mt5.length} MT5 shown`]
  for (const a of list.accounts) {
    out.push(`  - ${a.displayName}: ${list.trades.filter((t) => t.accountId === a.id).length} trades (read model)`)
  }
  for (const account of mt5) {
    const own = trades.list({ accountId: account.id })
    let execs = 0
    for (const t of own) execs += trades.listExecutions(t.id).length
    const symbols = new Map<string, number>()
    for (const t of own) symbols.set(t.instrument, (symbols.get(t.instrument) ?? 0) + 1)
    const dates = own.map((t) => t.analyticalTradeDate).sort()
    out.push(
      `MT5 account ${maskedLoginOf(account.sourceAccountId)} (${account.displayName}), currency ${account.currency}, timezone ${account.timezone ?? 'unknown (shown as UTC)'}:`
    )
    out.push(
      `  trades ${own.length}; executions ${execs}; LONG ${own.filter((t) => t.direction === 'LONG').length}, SHORT ${own.filter((t) => t.direction === 'SHORT').length}`
    )
    out.push(
      `  dates ${dates.length === 0 ? 'n/a' : `${dates[0]} .. ${dates[dates.length - 1]}`}; distinct symbols ${symbols.size}: ${[...symbols].map(([s, n]) => `${s} x${n}`).join(', ')}`
    )
    out.push(
      `  totals gross ${sumDecimals(own.map((t) => t.grossPnl))}, commission ${sumDecimals(own.map((t) => t.commission))}, fees ${sumDecimals(own.map((t) => t.fees))}, swap ${sumDecimals(own.map((t) => t.swap))}, net ${sumDecimals(own.map((t) => t.netPnl))}`
    )
    const withStrategy = own.filter((t) => t.strategyVersionId !== null).length
    const evals = own.reduce((n, t) => n + evaluations.listForTrade(t.id).length, 0)
    const tradeNotes = own.filter((t) => notes.getTradeNote(t.id) !== null).length
    out.push(`  strategy assigned ${withStrategy}; rule evaluations ${evals}; trade notes ${tradeNotes}`)
  }
  return out
}
