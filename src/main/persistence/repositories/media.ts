import { newId } from '../ids'
import type { Clock } from '../ids'
import type { Row, Sql } from '../sql'
import { int, str, strOrNull } from '../sql'
import type { MediaFormat, MediaStage, MediaTimeframe, TradeMedia } from '../types'

export interface NewTradeMedia {
  tradeId: string
  accountId: string
  managedPath: string
  format: MediaFormat
  timeframe: MediaTimeframe
  stage: MediaStage
  caption: string | null
  /** Whether this row should be inserted already featured (the service decides — e.g. the Trade's first image). */
  isFeatured: boolean
}

export interface NewDayMedia {
  accountId: string
  analyticalDate: string
  managedPath: string
  format: MediaFormat
  timeframe: MediaTimeframe
  stage: MediaStage
  caption: string | null
}

function toMedia(row: Row): TradeMedia {
  return {
    id: str(row['id']),
    ownerType: str(row['owner_type']) === 'DAY' ? 'DAY' : 'TRADE',
    tradeId: strOrNull(row['trade_id']),
    accountId: str(row['account_id']),
    analyticalDate: strOrNull(row['analytical_date']),
    managedPath: str(row['managed_path']),
    format: str(row['format']) as MediaFormat,
    timeframe: str(row['timeframe']) as MediaTimeframe,
    stage: str(row['stage']) as MediaStage,
    caption: strOrNull(row['caption']),
    isFeatured: int(row['is_featured']) === 1,
    createdAt: int(row['created_at'])
  }
}

/**
 * Chart Evidence metadata. Image bytes never pass through here — only the
 * relative managed path a caller already validated and wrote to disk. See
 * docs/TRADE_MEDIA.md.
 */
export class MediaRepository {
  constructor(
    private readonly sql: Sql,
    private readonly now: Clock
  ) {}

  createForTrade(input: NewTradeMedia): TradeMedia {
    const id = newId()
    this.sql.run(
      `INSERT INTO trade_media
         (id, owner_type, trade_id, account_id, analytical_date, managed_path, format, timeframe, stage, caption, is_featured, created_at)
       VALUES (?, 'TRADE', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.tradeId,
        input.accountId,
        input.managedPath,
        input.format,
        input.timeframe,
        input.stage,
        input.caption,
        input.isFeatured ? 1 : 0,
        BigInt(this.now())
      ]
    )
    return this.require(id)
  }

  createForDay(input: NewDayMedia): TradeMedia {
    const id = newId()
    this.sql.run(
      `INSERT INTO trade_media
         (id, owner_type, trade_id, account_id, analytical_date, managed_path, format, timeframe, stage, caption, is_featured, created_at)
       VALUES (?, 'DAY', NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        id,
        input.accountId,
        input.analyticalDate,
        input.managedPath,
        input.format,
        input.timeframe,
        input.stage,
        input.caption,
        BigInt(this.now())
      ]
    )
    return this.require(id)
  }

  getById(id: string): TradeMedia | null {
    const row = this.sql.get('SELECT * FROM trade_media WHERE id = ?', [id])
    return row === undefined ? null : toMedia(row)
  }

  require(id: string): TradeMedia {
    const media = this.getById(id)
    if (media === null) throw new Error(`Trade media not found: ${id}`)
    return media
  }

  listForTrade(tradeId: string): TradeMedia[] {
    return this.sql
      .all('SELECT * FROM trade_media WHERE trade_id = ? ORDER BY created_at, id', [tradeId])
      .map(toMedia)
  }

  countForTrade(tradeId: string): number {
    const row = this.sql.get('SELECT COUNT(*) AS n FROM trade_media WHERE trade_id = ?', [tradeId])
    return row === undefined ? 0 : int(row['n'])
  }

  /**
   * Explicit user choice: exactly one row of this Trade is featured
   * afterward — the target — atomically (unset before set, since the
   * partial unique index forbids two featured rows at once mid-statement).
   */
  setFeatured(tradeId: string, mediaId: string): void {
    this.sql.run('UPDATE trade_media SET is_featured = 0 WHERE trade_id = ? AND is_featured = 1', [tradeId])
    this.sql.run('UPDATE trade_media SET is_featured = 1 WHERE id = ?', [mediaId])
  }

  /**
   * Deterministic fallback after the featured item is deleted: the most
   * recently added remaining image for the Trade becomes featured. A no-op
   * if the Trade already has a featured row or has no media left.
   */
  promoteNewestFeatured(tradeId: string): void {
    const row = this.sql.get(
      'SELECT id FROM trade_media WHERE trade_id = ? AND NOT EXISTS (SELECT 1 FROM trade_media WHERE trade_id = ? AND is_featured = 1) ORDER BY created_at DESC, id DESC LIMIT 1',
      [tradeId, tradeId]
    )
    if (row === undefined) return
    this.sql.run('UPDATE trade_media SET is_featured = 1 WHERE id = ?', [str(row['id'])])
  }

  listForDay(accountId: string, analyticalDate: string): TradeMedia[] {
    return this.sql
      .all('SELECT * FROM trade_media WHERE account_id = ? AND analytical_date = ? ORDER BY created_at, id', [
        accountId,
        analyticalDate
      ])
      .map(toMedia)
  }

  /** Deletes the metadata row and returns it (so the caller can remove the managed file), or null if it never existed. */
  delete(id: string): TradeMedia | null {
    const media = this.getById(id)
    if (media === null) return null
    this.sql.run('DELETE FROM trade_media WHERE id = ?', [id])
    return media
  }
}
