/**
 * Chart Evidence / Trade Media IPC contract (Checkpoint 014). See
 * docs/TRADE_MEDIA.md. Application-level shapes only — no filesystem paths,
 * no raw image bytes on read. Image bytes cross the boundary exactly twice,
 * both writer-side: a captured PNG frame from the renderer's own canvas, and
 * the staged-upload/staged-capture finalize call never re-sends bytes.
 * Reading an image back goes through the read-only `ssmedia://` protocol
 * (main-process only, scoped to the media root, never a generic filesystem
 * API), not through IPC.
 */

import type { IpcResult } from './result'

export type MediaTimeframeDto = 'M1' | 'M3' | 'M5' | 'M15' | 'M30' | 'H1' | 'H2' | 'H4' | 'D1' | 'W1' | 'OTHER'
export const MEDIA_TIMEFRAMES: readonly MediaTimeframeDto[] = [
  'M1',
  'M3',
  'M5',
  'M15',
  'M30',
  'H1',
  'H2',
  'H4',
  'D1',
  'W1',
  'OTHER'
]

export type MediaStageDto = 'PRE_TRADE' | 'ENTRY' | 'MANAGEMENT' | 'EXIT' | 'POST_TRADE'
export const MEDIA_STAGES: readonly MediaStageDto[] = ['PRE_TRADE', 'ENTRY', 'MANAGEMENT', 'EXIT', 'POST_TRADE']

export type MediaFormatDto = 'PNG' | 'JPEG' | 'WEBP'

export interface MediaItemDto {
  id: string
  ownerType: 'TRADE' | 'DAY'
  tradeId: string | null
  accountId: string
  analyticalDate: string | null
  format: MediaFormatDto
  timeframe: MediaTimeframeDto
  stage: MediaStageDto
  /** '' when none was entered. */
  caption: string
  /** Trade-level only; a Day media item is never featured. At most one featured item per Trade. */
  isFeatured: boolean
  createdAt: number
  /** ssmedia://<id> — a read-only, scoped protocol URL; never a filesystem path. */
  url: string
}

/** A screen/window the user can capture, for Solid Skill's own capture-source picker. */
export interface CaptureSourceDto {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** Data URL thumbnail for the picker grid. */
  thumbnailDataUrl: string
}

/**
 * A validated image staged in main-process memory (never written to disk
 * until finalized, never keyed by a filesystem path). Expires a few minutes
 * after staging if never finalized.
 */
export interface StagedImageDto {
  token: string
  format: MediaFormatDto
  previewDataUrl: string
}

export interface AddTradeMediaRequest {
  tradeId: string
  token: string
  timeframe: MediaTimeframeDto
  stage: MediaStageDto
  caption: string
}

export interface AddDayMediaRequest {
  accountId: string
  date: string
  token: string
  timeframe: MediaTimeframeDto
  stage: MediaStageDto
  caption: string
}

/** Marks one Trade media item as the Overview's Chart Evidence image; unsets any previously featured item for that Trade. */
export interface SetFeaturedTradeMediaRequest {
  tradeId: string
  mediaId: string
}

export interface MediaApi {
  listForTrade(tradeId: string): Promise<IpcResult<MediaItemDto[]>>
  listForDay(request: { accountId: string; date: string }): Promise<IpcResult<MediaItemDto[]>>
  /** Opens a native file picker (PNG/JPEG/WebP), validates the chosen file, and stages it. The original path never leaves main. */
  pickImageFile(): Promise<IpcResult<StagedImageDto | null>>
  /** Validates a PNG frame captured by the renderer's own canvas and stages it. */
  stageCapturedImage(bytes: ArrayBuffer): Promise<IpcResult<StagedImageDto>>
  listCaptureSources(): Promise<IpcResult<CaptureSourceDto[]>>
  addTradeMedia(request: AddTradeMediaRequest): Promise<IpcResult<MediaItemDto>>
  addDayMedia(request: AddDayMediaRequest): Promise<IpcResult<MediaItemDto>>
  delete(mediaId: string): Promise<IpcResult<{ id: string }>>
  /** Sets the Trade's featured (Overview) image; returns the Trade's full, updated media list. */
  setFeaturedTradeMedia(request: SetFeaturedTradeMediaRequest): Promise<IpcResult<MediaItemDto[]>>
}

export const MEDIA_CHANNELS = {
  listForTrade: 'media:listForTrade',
  listForDay: 'media:listForDay',
  pickImageFile: 'media:pickImageFile',
  stageCapturedImage: 'media:stageCapturedImage',
  listCaptureSources: 'media:listCaptureSources',
  addTradeMedia: 'media:addTradeMedia',
  addDayMedia: 'media:addDayMedia',
  delete: 'media:delete',
  setFeaturedTradeMedia: 'media:setFeaturedTradeMedia'
} as const

export type MediaChannel = (typeof MEDIA_CHANNELS)[keyof typeof MEDIA_CHANNELS]
