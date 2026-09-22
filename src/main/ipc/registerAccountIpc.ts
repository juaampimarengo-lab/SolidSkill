import { BrowserWindow, ipcMain } from 'electron'
import type { AccountChannel } from '../../shared/ipc/accounts'
import type { AccountHandlerDeps } from './accountHandlers'
import { createAccountHandlers } from './accountHandlers'

/** Registers exactly the Accounts channels, only for this app's own windows. */
export function registerAccountIpc(deps: AccountHandlerDeps): void {
  const handlers = createAccountHandlers(deps)
  for (const channel of Object.keys(handlers) as AccountChannel[]) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (BrowserWindow.fromWebContents(event.sender) === null) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unrecognized caller' } }
      }
      return handlers[channel](payload)
    })
  }
}
