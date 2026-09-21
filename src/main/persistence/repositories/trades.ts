import type { Decimal } from '../fixedPoint'
import {
  decimalToScaled,
  decimalToScaledOrNull,
  scaledToDecimal,
  scaledToDecimalOrNull
} from '../fixedPoint'
import { newId } from '../ids'
import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { big, bigOrNull, int, intOrNull, str, strOrNull } from '../sql'
import type { Execution, ExecutionSide, Trade, TradeDirection } from '../types'
import type { AccountRepository } from './accounts'

/**
 * A normalized execution fact handed to persistence. The persistence layer
 * stores it as given: it does not infer direction, pair fills, or fetch
 * anything from a broker.
 */
export interface NewExecution {
  sourceExecutionId?: string | null
  sourcePositionId?: string | null
  executedAt: number
  side: ExecutionSide
  quantity: Decimal
  price: Decimal
  /** Optional signed costs (negative = cost); omit/null when the source did not report them. */
  commission?: Decimal | null
  fees?: Decimal | null
  swap?: Decimal | null
}

/** A normalized Trade plus the executions that belong to it. */
export interface NewTrade {
  accountId: string
  sourceTradeId?: string | null
  sourcePositionId?: string | null
  analyticalTradeDate: string
  instrument: string
  /** Stored as given. Never derived from execution sides. */
  direction: TradeDirection
  quantity: Decimal
  openedAt: number
  closedAt?: number | null
  avgEntryPrice: Decimal
  avgExitPrice?: Decimal | null
  grossPnl?: Decimal | null
  /**
   * Signed costs (negative = cost); omit/null when the source did not report
   * them. If grossPnl and netPnl are both given: net = gross + commission +
   * fees + swap (missing categories count as 0).
   */
  commission?: Decimal | null
  fees?: Decimal | null
  swap?: Decimal | null
  netPnl?: Decimal | null
  plannedR?: Decimal | null
  realizedR?: Decimal | null
  executions: NewExecution[]
}

export interface TradeFilter {
  accountId?: string
  /** Inclusive 'YYYY-MM-DD' bounds on analytical trade date. */
  fromDate?: string
  toDate?: string
}

export function toTrade(row: Row): Trade {
  return {
    id: str(row['id']),
    accountId: str(row['account_id']),
    sourcePlatform: str(row['source_platform']),
    sourceTradeId: strOrNull(row['source_trade_id']),
    sourcePositionId: strOrNull(row['source_position_id']),
    analyticalTradeDate: str(row['analytical_trade_date']),
    instrument: str(row['instrument']),
    direction: str(row['direction']) === 'SHORT' ? 'SHORT' : 'LONG',
    quantity: scaledToDecimal(big(row['quantity'])),
    openedAt: int(row['opened_at']),
    closedAt: intOrNull(row['closed_at']),
    avgEntryPrice: scaledToDecimal(big(row['avg_entry_price'])),
    avgExitPrice: scaledToDecimalOrNull(bigOrNull(row['avg_exit_price'])),
    grossPnl: scaledToDecimalOrNull(bigOrNull(row['gross_pnl'])),
    commission: scaledToDecimalOrNull(bigOrNull(row['commission'])),
    fees: scaledToDecimalOrNull(bigOrNull(row['fees'])),
    swap: scaledToDecimalOrNull(bigOrNull(row['swap'])),
    netPnl: scaledToDecimalOrNull(bigOrNull(row['net_pnl'])),
    plannedR: scaledToDecimalOrNull(bigOrNull(row['planned_r'])),
    realizedR: scaledToDecimalOrNull(bigOrNull(row['realized_r'])),
    strategyVersionId: strOrNull(row['strategy_version_id']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

function toExecution(row: Row): Execution {
  return {
    id: str(row['id']),
    tradeId: str(row['trade_id']),
    accountId: str(row['account_id']),
    sourcePlatform: str(row['source_platform']),
    sourceExecutionId: strOrNull(row['source_execution_id']),
    sourcePositionId: strOrNull(row['source_position_id']),
    executedAt: int(row['executed_at']),
    side: str(row['side']) === 'SELL' ? 'SELL' : 'BUY',
    quantity: scaledToDecimal(big(row['quantity'])),
    price: scaledToDecimal(big(row['price'])),
    commission: scaledToDecimalOrNull(bigOrNull(row['commission'])),
    fees: scaledToDecimalOrNull(bigOrNull(row['fees'])),
    swap: scaledToDecimalOrNull(bigOrNull(row['swap'])),
    createdAt: int(row['created_at'])
  }
}

export class TradeRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock,
    private readonly accounts: AccountRepository
  ) {}

  /**
   * Persists one Trade and all of its Executions atomically. One Trade owns
   * any number of executions (BUY,BUY,SELL,SELL is still one Trade).
   */
  createTrade(input: NewTrade): Trade {
    if (input.executions.length === 0) {
      throw new Error('A trade must be created with at least one execution')
    }
    const gross = decimalToScaledOrNull(input.grossPnl)
    const net = decimalToScaledOrNull(input.netPnl)
    const commission = decimalToScaledOrNull(input.commission)
    const fees = decimalToScaledOrNull(input.fees)
    const swap = decimalToScaledOrNull(input.swap)
    // Storage convention: every cost category is a signed P&L contribution
    // (a cost is negative), so net = gross + commission + fees + swap, with an
    // unreported category counting as 0. Reject inconsistent facts loudly.
    if (
      gross !== null &&
      net !== null &&
      net !== gross + (commission ?? 0n) + (fees ?? 0n) + (swap ?? 0n)
    ) {
      throw new Error('netPnl must equal grossPnl + commission + fees + swap')
    }

    return this.sql.transaction(() => {
      const account = this.accounts.require(input.accountId)
      const tradeId = newId()
      const at = BigInt(this.now())
      this.sql.run(
        `INSERT INTO trades (
           id, account_id, source_platform, source_trade_id, source_position_id,
           analytical_trade_date, instrument, direction, quantity, opened_at, closed_at,
           avg_entry_price, avg_exit_price, gross_pnl, commission, fees, swap,
           net_pnl, planned_r, realized_r, strategy_version_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          tradeId,
          account.id,
          account.sourcePlatform,
          input.sourceTradeId ?? null,
          input.sourcePositionId ?? null,
          input.analyticalTradeDate,
          input.instrument,
          input.direction,
          decimalToScaled(input.quantity),
          BigInt(input.openedAt),
          input.closedAt === undefined || input.closedAt === null ? null : BigInt(input.closedAt),
          decimalToScaled(input.avgEntryPrice),
          decimalToScaledOrNull(input.avgExitPrice),
          gross,
          commission,
          fees,
          swap,
          net,
          decimalToScaledOrNull(input.plannedR),
          decimalToScaledOrNull(input.realizedR),
          at,
          at
        ]
      )
      for (const execution of input.executions) {
        this.sql.run(
          `INSERT INTO executions (
             id, trade_id, account_id, source_platform, source_execution_id, source_position_id,
             executed_at, side, quantity, price, commission, fees, swap, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId(),
            tradeId,
            account.id,
            account.sourcePlatform,
            execution.sourceExecutionId ?? null,
            execution.sourcePositionId ?? null,
            BigInt(execution.executedAt),
            execution.side,
            decimalToScaled(execution.quantity),
            decimalToScaled(execution.price),
            decimalToScaledOrNull(execution.commission),
            decimalToScaledOrNull(execution.fees),
            decimalToScaledOrNull(execution.swap),
            at
          ]
        )
      }
      return this.require(tradeId)
    })
  }

  getById(id: string): Trade | null {
    const row = this.sql.get('SELECT * FROM trades WHERE id = ?', [id])
    return row === undefined ? null : toTrade(row)
  }

  /** Reconciliation lookup by the integration's stable Trade identity (unique per platform + account). */
  findBySourceTradeId(sourcePlatform: string, accountId: string, sourceTradeId: string): Trade | null {
    const row = this.sql.get(
      'SELECT * FROM trades WHERE source_platform = ? AND account_id = ? AND source_trade_id = ?',
      [sourcePlatform, accountId, sourceTradeId]
    )
    return row === undefined ? null : toTrade(row)
  }

  /** Reconciliation lookup of one execution by its stable source identity. */
  findExecutionBySourceId(
    sourcePlatform: string,
    accountId: string,
    sourceExecutionId: string
  ): Execution | null {
    const row = this.sql.get(
      'SELECT * FROM executions WHERE source_platform = ? AND account_id = ? AND source_execution_id = ?',
      [sourcePlatform, accountId, sourceExecutionId]
    )
    return row === undefined ? null : toExecution(row)
  }

  require(id: string): Trade {
    const trade = this.getById(id)
    if (trade === null) throw new Error(`Trade not found: ${id}`)
    return trade
  }

  list(filter: TradeFilter = {}): Trade[] {
    const clauses: string[] = []
    const params: string[] = []
    if (filter.accountId !== undefined) {
      clauses.push('account_id = ?')
      params.push(filter.accountId)
    }
    if (filter.fromDate !== undefined) {
      clauses.push('analytical_trade_date >= ?')
      params.push(filter.fromDate)
    }
    if (filter.toDate !== undefined) {
      clauses.push('analytical_trade_date <= ?')
      params.push(filter.toDate)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    return this.sql
      .all(`SELECT * FROM trades ${where} ORDER BY opened_at, id`, params)
      .map(toTrade)
  }

  /** Executions of one Trade in time order (ties broken by creation order of the rows). */
  listExecutions(tradeId: string): Execution[] {
    return this.sql
      .all('SELECT * FROM executions WHERE trade_id = ? ORDER BY executed_at, rowid', [tradeId])
      .map(toExecution)
  }

  /**
   * Records which exact published Strategy Version this Trade is evaluated
   * against, and creates one UNREVIEWED evaluation per rule of that version.
   * A Trade's association is set once: it can never be re-pointed at another
   * version (enforced here and by a schema trigger).
   */
  associateStrategyVersion(tradeId: string, strategyVersionId: string): Trade {
    return this.sql.transaction(() => {
      const trade = this.require(tradeId)
      if (trade.strategyVersionId !== null) {
        throw new Error(`Trade ${tradeId} is already associated with a strategy version`)
      }
      const version = this.sql.get('SELECT state FROM strategy_versions WHERE id = ?', [
        strategyVersionId
      ])
      if (version === undefined) throw new Error(`Strategy version not found: ${strategyVersionId}`)
      if (str(version['state']) !== 'PUBLISHED') {
        throw new Error('A trade can only be associated with a published strategy version')
      }
      const at = BigInt(this.now())
      this.sql.run('UPDATE trades SET strategy_version_id = ?, updated_at = ? WHERE id = ?', [
        strategyVersionId,
        at,
        tradeId
      ])
      const rules = this.sql.all('SELECT id FROM rules WHERE strategy_version_id = ?', [
        strategyVersionId
      ])
      for (const rule of rules) {
        this.sql.run(
          `INSERT INTO trade_rule_evaluations (id, trade_id, strategy_version_id, rule_id, state,
                                               evaluated_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'UNREVIEWED', NULL, ?, ?)`,
          [newId(), tradeId, strategyVersionId, str(rule['id']), at, at]
        )
      }
      return this.require(tradeId)
    })
  }
}
