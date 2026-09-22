import { BrowserWindow, desktopCapturer, dialog, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import type { IpcResult } from '../../shared/ipc/result'
import { MEDIA_CHANNELS } from '../../shared/ipc/media'
import type { CaptureSourceDto, StagedImageDto } from '../../shared/ipc/media'
import { ServiceError } from '../serviceError'
import type { MediaHandlerDeps } from './mediaHandlers'
import { createMediaHandlers } from './mediaHandlers'

const OPEN_FILTERS = [{ name: 'Chart images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]

function unavailable<T>(): IpcResult<T> {
  return {
    ok: false,
    error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'The local database could not be opened, so chart evidence cannot be loaded or saved.' }
  }
}

/**
 * Registers exactly the Chart Evidence channels, nothing generic. A call is
 * only honoured when it comes from one of this app's own windows. The two
 * channels backed by native Electron APIs (a real file-open dialog, and the
 * screen/window source list for the capture picker) are handled here, the
 * only place in this feature that imports Electron beyond ipcMain/BrowserWindow
 * — never in the renderer, and never as a generic filesystem/capture API.
 */
export function registerMediaIpc(deps: MediaHandlerDeps): void {
  const handlers = createMediaHandlers(deps)
  const C = MEDIA_CHANNELS

  for (const channel of Object.keys(handlers) as (keyof typeof handlers)[]) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (BrowserWindow.fromWebContents(event.sender) === null) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unrecognized caller' } }
      }
      return handlers[channel](payload)
    })
  }

  ipcMain.handle(C.pickImageFile, async (event): Promise<IpcResult<StagedImageDto | null>> => {
    if (BrowserWindow.fromWebContents(event.sender) === null) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unrecognized caller' } }
    }
    const service = deps.getService()
    if (service === null) return unavailable()
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const picked = owner
      ? await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: OPEN_FILTERS })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: OPEN_FILTERS })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: true, data: null }
    try {
      const buffer = readFileSync(picked.filePaths[0])
      return { ok: true, data: service.stage(buffer) }
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, error: { code: error.code, message: error.message } }
      deps.log('failed to read picked image file', error)
      return { ok: false, error: { code: 'INTERNAL', message: 'Could not read the selected file.' } }
    }
  })

  ipcMain.handle(C.listCaptureSources, async (event): Promise<IpcResult<CaptureSourceDto[]>> => {
    if (BrowserWindow.fromWebContents(event.sender) === null) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unrecognized caller' } }
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false
      })
      const data: CaptureSourceDto[] = sources.map((source) => ({
        id: source.id,
        name: source.name.trim() !== '' ? source.name : source.id.startsWith('screen') ? 'Screen' : 'Window',
        kind: source.id.startsWith('screen') ? 'screen' : 'window',
        thumbnailDataUrl: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL()
      }))
      return { ok: true, data }
    } catch (error) {
      deps.log('failed to list capture sources', error)
      return { ok: false, error: { code: 'INTERNAL', message: 'Could not list capture sources.' } }
    }
  })
}
