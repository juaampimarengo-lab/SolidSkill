import { randomUUID } from 'node:crypto'
import type { Database, MediaFormat } from '../persistence'
import type {
  AddDayMediaRequest,
  AddTradeMediaRequest,
  MediaItemDto,
  SetFeaturedTradeMediaRequest,
  StagedImageDto
} from '../../shared/ipc/media'
import { ServiceError } from '../serviceError'
import { MEDIA_CONTENT_TYPE, validateImageBuffer, type MediaStorage } from './mediaStorage'
import type { TradeMedia } from '../persistence/types'

const STAGE_TTL_MS = 5 * 60 * 1000
const MAX_CAPTION = 500

interface StagedImage {
  buffer: Buffer
  format: MediaFormat
  timer: NodeJS.Timeout
}

export function toMediaItemDto(media: TradeMedia): MediaItemDto {
  return {
    id: media.id,
    ownerType: media.ownerType,
    tradeId: media.tradeId,
    accountId: media.accountId,
    analyticalDate: media.analyticalDate,
    format: media.format,
    timeframe: media.timeframe,
    stage: media.stage,
    caption: media.caption ?? '',
    isFeatured: media.isFeatured,
    createdAt: media.createdAt,
    url: `ssmedia://${media.id}`
  }
}

function toDataUrl(format: MediaFormat, buffer: Buffer): string {
  return `data:${MEDIA_CONTENT_TYPE[format]};base64,${buffer.toString('base64')}`
}

function caption(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length > MAX_CAPTION) throw new ServiceError('INVALID_INPUT', 'Caption is too long.')
  return trimmed === '' ? null : trimmed
}

/**
 * Chart Evidence application service (Checkpoint 014). Composes the media
 * repository with on-disk storage. Image bytes are staged in memory (keyed by
 * a short-lived opaque token) between "pick/capture" and "save", so the
 * Add Chart flow can preview before Save without ever writing a file the user
 * might cancel. No Electron imports here: dialog and desktopCapturer live in
 * the IPC layer, which hands this service plain buffers. See docs/TRADE_MEDIA.md.
 */
export class MediaService {
  private readonly staged = new Map<string, StagedImage>()

  constructor(
    private readonly db: Database,
    private readonly storage: MediaStorage
  ) {}

  listForTrade(tradeId: string): MediaItemDto[] {
    return this.db.repositories.media.listForTrade(tradeId).map(toMediaItemDto)
  }

  listForDay(accountId: string, date: string): MediaItemDto[] {
    return this.db.repositories.media.listForDay(accountId, date).map(toMediaItemDto)
  }

  /** Validates arbitrary bytes (a picked file or a captured canvas frame) and stages them for a following Save. */
  stage(buffer: Buffer): StagedImageDto {
    const format = validateImageBuffer(buffer)
    const token = randomUUID()
    const timer = setTimeout(() => this.staged.delete(token), STAGE_TTL_MS)
    timer.unref?.()
    this.staged.set(token, { buffer, format, timer })
    return { token, format, previewDataUrl: toDataUrl(format, buffer) }
  }

  addTradeMedia(request: AddTradeMediaRequest): MediaItemDto {
    return this.db.transaction(() => {
      const trade = this.db.repositories.trades.getById(request.tradeId)
      if (trade === null) throw new ServiceError('NOT_FOUND', 'Trade not found.')
      const { buffer, format } = this.take(request.token)
      const id = randomUUID()
      const managedPath = this.storage.writeTradeImage(trade.id, id, format, buffer)
      // The Trade's first image becomes the Overview's featured chart
      // automatically; every later image starts unfeatured (the user picks).
      const isFeatured = this.db.repositories.media.countForTrade(trade.id) === 0
      try {
        const media = this.db.repositories.media.createForTrade({
          tradeId: trade.id,
          accountId: trade.accountId,
          managedPath,
          format,
          timeframe: request.timeframe,
          stage: request.stage,
          caption: caption(request.caption),
          isFeatured
        })
        return toMediaItemDto(media)
      } catch (error) {
        this.storage.deleteIfManaged(managedPath)
        throw error
      }
    })
  }

  addDayMedia(request: AddDayMediaRequest): MediaItemDto {
    return this.db.transaction(() => {
      const account = this.db.repositories.accounts.getById(request.accountId)
      if (account === null) throw new ServiceError('NOT_FOUND', 'Account not found.')
      const { buffer, format } = this.take(request.token)
      const id = randomUUID()
      const managedPath = this.storage.writeDayImage(account.id, request.date, id, format, buffer)
      try {
        const media = this.db.repositories.media.createForDay({
          accountId: account.id,
          analyticalDate: request.date,
          managedPath,
          format,
          timeframe: request.timeframe,
          stage: request.stage,
          caption: caption(request.caption)
        })
        return toMediaItemDto(media)
      } catch (error) {
        this.storage.deleteIfManaged(managedPath)
        throw error
      }
    })
  }

  /**
   * Removes the DB row first, then best-effort removes the file — a missing
   * file never blocks removal. If the deleted item was the Trade's featured
   * chart, the newest remaining Trade image is promoted so the Trade's
   * Overview never silently goes from "has a chart" to a confusing blank
   * state without an explicit choice existing anymore.
   */
  delete(mediaId: string): { id: string } {
    return this.db.transaction(() => {
      const media = this.db.repositories.media.delete(mediaId)
      if (media === null) throw new ServiceError('NOT_FOUND', 'Media not found.')
      this.storage.deleteIfManaged(media.managedPath)
      if (media.ownerType === 'TRADE' && media.isFeatured && media.tradeId !== null) {
        this.db.repositories.media.promoteNewestFeatured(media.tradeId)
      }
      return { id: media.id }
    })
  }

  /** Explicit user choice of the Overview image. Returns the Trade's full, updated media list. */
  setFeaturedTradeMedia(request: SetFeaturedTradeMediaRequest): MediaItemDto[] {
    return this.db.transaction(() => {
      const media = this.db.repositories.media.getById(request.mediaId)
      if (media === null || media.ownerType !== 'TRADE' || media.tradeId !== request.tradeId) {
        throw new ServiceError('NOT_FOUND', 'Media not found for this Trade.')
      }
      this.db.repositories.media.setFeatured(request.tradeId, request.mediaId)
      return this.listForTrade(request.tradeId)
    })
  }

  private take(token: string): { buffer: Buffer; format: MediaFormat } {
    const staged = this.staged.get(token)
    if (staged === undefined) {
      throw new ServiceError('INVALID_INPUT', 'That staged image has expired. Pick or capture the chart again.')
    }
    clearTimeout(staged.timer)
    this.staged.delete(token)
    return staged
  }
}
