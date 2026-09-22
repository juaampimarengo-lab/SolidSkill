import { BrowserWindow, ipcMain } from 'electron'
import type { ReviewChannel } from '../../shared/ipc/reviews'
import type { ReviewHandlerDeps } from './reviewHandlers'
import { createReviewHandlers } from './reviewHandlers'

/** Registers exactly the Weekly Review channels, only for this app's own windows. */
export function registerReviewIpc(deps: ReviewHandlerDeps): void {
  const handlers = createReviewHandlers(deps)
  for (const channel of Object.keys(handlers) as ReviewChannel[]) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (BrowserWindow.fromWebContents(event.sender) === null) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unrecognized caller' } }
      }
      return handlers[channel](payload)
    })
  }
}
