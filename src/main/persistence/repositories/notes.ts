import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, str } from '../sql'
import type { DayNote, TradeNote } from '../types'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function toTradeNote(row: Row): TradeNote {
  return {
    tradeId: str(row['trade_id']),
    body: str(row['body']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

function toDayNote(row: Row): DayNote {
  return {
    accountId: str(row['account_id']),
    tradeDate: str(row['trade_date']),
    body: str(row['body']),
    createdAt: int(row['created_at']),
    updatedAt: int(row['updated_at'])
  }
}

/** Plain-text notes: one per Trade, one per (account, analytical date). */
export class NoteRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  getTradeNote(tradeId: string): TradeNote | null {
    const row = this.sql.get('SELECT * FROM trade_notes WHERE trade_id = ?', [tradeId])
    return row === undefined ? null : toTradeNote(row)
  }

  upsertTradeNote(tradeId: string, body: string): TradeNote {
    const at = BigInt(this.now())
    this.sql.run(
      `INSERT INTO trade_notes (trade_id, body, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (trade_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      [tradeId, body, at, at]
    )
    const note = this.getTradeNote(tradeId)
    if (note === null) throw new Error(`Trade note missing after upsert: ${tradeId}`)
    return note
  }

  getDayNote(accountId: string, tradeDate: string): DayNote | null {
    const row = this.sql.get('SELECT * FROM day_notes WHERE account_id = ? AND trade_date = ?', [
      accountId,
      tradeDate
    ])
    return row === undefined ? null : toDayNote(row)
  }

  upsertDayNote(accountId: string, tradeDate: string, body: string): DayNote {
    if (!DATE_PATTERN.test(tradeDate)) throw new Error(`Invalid trade date: ${tradeDate}`)
    const at = BigInt(this.now())
    this.sql.run(
      `INSERT INTO day_notes (account_id, trade_date, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id, trade_date)
       DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      [accountId, tradeDate, body, at, at]
    )
    const note = this.getDayNote(accountId, tradeDate)
    if (note === null) throw new Error(`Day note missing after upsert: ${accountId} ${tradeDate}`)
    return note
  }
}
