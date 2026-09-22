import type { IpcResult } from '../../shared/ipc/result'
import { MEDIA_CHANNELS } from '../../shared/ipc/media'
import { ServiceError } from '../serviceError'
import type { MediaService } from '../media/mediaService'
import {
  addDayMediaInput,
  addTradeMediaInput,
  mediaDayInput,
  mediaIdInput,
  mediaTradeIdInput,
  setFeaturedTradeMediaInput
} from './validation'

/**
 * The Electron-free half of the Chart Evidence IPC surface — everything that
 * is pure service logic (list/add/delete/stage-bytes). No Electron import
 * here, so this is directly unit-testable (mirrors tradeHandlers.ts). The two
 * channels that need a real native dialog or desktopCapturer
 * (`pickImageFile`, `listCaptureSources`) are wired directly in
 * registerMediaIpc.ts, the only place in this feature that touches Electron.
 */
export type MediaHandler = (payload: unknown) => IpcResult<unknown>
export type MediaServiceChannel =
  | typeof MEDIA_CHANNELS.listForTrade
  | typeof MEDIA_CHANNELS.listForDay
  | typeof MEDIA_CHANNELS.addTradeMedia
  | typeof MEDIA_CHANNELS.addDayMedia
  | typeof MEDIA_CHANNELS.delete
  | typeof MEDIA_CHANNELS.stageCapturedImage
  | typeof MEDIA_CHANNELS.setFeaturedTradeMedia

export interface MediaHandlerDeps {
  /** null when the database failed to initialize; every call then reports PERSISTENCE_UNAVAILABLE. */
  getService: () => MediaService | null
  log: (message: string, error: unknown) => void
}

export function createMediaHandlers(deps: MediaHandlerDeps): Record<MediaServiceChannel, MediaHandler> {
  function run<T>(fn: (service: MediaService) => T): IpcResult<T> {
    const service = deps.getService()
    if (service === null) {
      return {
        ok: false,
        error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'The local database could not be opened, so chart evidence cannot be loaded or saved.' }
      }
    }
    try {
      return { ok: true, data: fn(service) }
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, error: { code: error.code, message: error.message } }
      deps.log('unexpected error in media handler', error)
      return { ok: false, error: { code: 'INTERNAL', message: 'An unexpected error occurred.' } }
    }
  }

  const C = MEDIA_CHANNELS
  return {
    [C.listForTrade]: (p) => run((s) => s.listForTrade(mediaTradeIdInput(p))),
    [C.listForDay]: (p) =>
      run((s) => {
        const input = mediaDayInput(p)
        return s.listForDay(input.accountId, input.date)
      }),
    [C.addTradeMedia]: (p) => run((s) => s.addTradeMedia(addTradeMediaInput(p))),
    [C.addDayMedia]: (p) => run((s) => s.addDayMedia(addDayMediaInput(p))),
    [C.delete]: (p) => run((s) => s.delete(mediaIdInput(p))),
    [C.setFeaturedTradeMedia]: (p) => run((s) => s.setFeaturedTradeMedia(setFeaturedTradeMediaInput(p))),
    [C.stageCapturedImage]: (p) =>
      run((s) => {
        if (!(p instanceof ArrayBuffer)) throw new ServiceError('INVALID_INPUT', 'Expected captured image bytes.')
        return s.stage(Buffer.from(new Uint8Array(p)))
      })
  }
}
