import type { Row, Sql } from '../sql'
import { int, str, strOrNull } from '../sql'
import type { Trade } from '../types'
import { toTrade } from './trades'
import type { TradeFilter } from './trades'

/** Rule-evaluation counts of one trade, by canonical state. */
export interface EvaluationCounts {
  pass: number
  fail: number
  na: number
  unreviewed: number
}

/** The exact Strategy + Version a trade is associated with, by persisted ids. */
export interface TradeStrategyRef {
  strategyId: string
  /** Current Strategy name — a label, never an identity. */
  strategyName: string
  versionId: string
  versionNumber: number
}

/**
 * A Trade with the context every list surface needs, read in two set-based
 * queries (trades+joins, then grouped evaluation counts) — no per-row lookups.
 */
export interface TradeSummaryRecord {
  trade: Trade
  accountName: string
  accountTimezone: string | null
  strategy: TradeStrategyRef | null
  counts: EvaluationCounts
}

const EMPTY_COUNTS: EvaluationCounts = { pass: 0, fail: 0, na: 0, unreviewed: 0 }

function whereFor(filter: TradeFilter & { tradeId?: string }): { where: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.tradeId !== undefined) {
    clauses.push('t.id = ?')
    params.push(filter.tradeId)
  }
  if (filter.accountId !== undefined) {
    clauses.push('t.account_id = ?')
    params.push(filter.accountId)
  }
  if (filter.fromDate !== undefined) {
    clauses.push('t.analytical_trade_date >= ?')
    params.push(filter.fromDate)
  }
  if (filter.toDate !== undefined) {
    clauses.push('t.analytical_trade_date <= ?')
    params.push(filter.toDate)
  }
  return { where: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`, params }
}

function toStrategyRef(row: Row): TradeStrategyRef | null {
  const strategyId = strOrNull(row['strategy_id'])
  const versionId = strOrNull(row['strategy_version_id'])
  if (strategyId === null || versionId === null) return null
  return {
    strategyId,
    strategyName: str(row['strategy_name']),
    versionId,
    versionNumber: int(row['version_number'])
  }
}

/**
 * Read-only query model for trading list/day views. It never writes and never
 * derives facts: direction, dates and P&L are exactly as persisted.
 */
export class TradeReadRepository {
  constructor(private readonly sql: Sql) {}

  /** Chronological by analytical date, then open time. */
  listSummaries(filter: TradeFilter & { tradeId?: string } = {}): TradeSummaryRecord[] {
    const { where, params } = whereFor(filter)
    const rows = this.sql.all(
      `SELECT t.*, a.display_name AS account_name, a.timezone AS account_timezone,
              s.id AS strategy_id, s.name AS strategy_name, v.version_number AS version_number
       FROM trades t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN strategy_versions v ON v.id = t.strategy_version_id
       LEFT JOIN strategies s ON s.id = v.strategy_id
       ${where}
       ORDER BY t.analytical_trade_date, t.opened_at, t.id`,
      params
    )
    const countRows = this.sql.all(
      `SELECT e.trade_id AS trade_id, e.state AS state, COUNT(*) AS n
       FROM trade_rule_evaluations e
       JOIN trades t ON t.id = e.trade_id
       ${where}
       GROUP BY e.trade_id, e.state`,
      params
    )
    const countsByTrade = new Map<string, EvaluationCounts>()
    for (const row of countRows) {
      const tradeId = str(row['trade_id'])
      const counts = countsByTrade.get(tradeId) ?? { ...EMPTY_COUNTS }
      const n = int(row['n'])
      switch (str(row['state'])) {
        case 'PASS':
          counts.pass = n
          break
        case 'FAIL':
          counts.fail = n
          break
        case 'N/A':
          counts.na = n
          break
        default:
          counts.unreviewed = n
      }
      countsByTrade.set(tradeId, counts)
    }
    return rows.map((row) => {
      const trade = toTrade(row)
      return {
        trade,
        accountName: str(row['account_name']),
        accountTimezone: strOrNull(row['account_timezone']),
        strategy: toStrategyRef(row),
        counts: countsByTrade.get(trade.id) ?? { ...EMPTY_COUNTS }
      }
    })
  }

  getSummary(tradeId: string): TradeSummaryRecord | null {
    return this.listSummaries({ tradeId })[0] ?? null
  }

  /** Distinct analytical dates on which this account has Trades, ascending. */
  listTradeDates(accountId: string): string[] {
    return this.sql
      .all(
        'SELECT DISTINCT analytical_trade_date AS d FROM trades WHERE account_id = ? ORDER BY analytical_trade_date',
        [accountId]
      )
      .map((row) => str(row['d']))
  }

  /** (account, date) pairs whose Day Note is non-empty. */
  listDaysWithNotes(filter: { accountId?: string } = {}): { accountId: string; tradeDate: string }[] {
    const where = filter.accountId === undefined ? '' : 'AND account_id = ?'
    return this.sql
      .all(
        `SELECT account_id, trade_date FROM day_notes WHERE trim(body) <> '' ${where} ORDER BY account_id, trade_date`,
        filter.accountId === undefined ? [] : [filter.accountId]
      )
      .map((row) => ({ accountId: str(row['account_id']), tradeDate: str(row['trade_date']) }))
  }
}
