import { BrowserWindow, ipcMain } from 'electron'
import type { StrategyChannel } from '../../shared/ipc/strategies'
import type { HandlerDeps } from './strategyHandlers'
import { createStrategyHandlers } from './strategyHandlers'

/**
 * Registers exactly the Strategy channels, nothing generic. A call is only
 * honoured when it comes from one of this app's own windows.
 */
export function registerStrategyIpc(deps: HandlerDeps): void {
  const handlers = createStrategyHandlers(deps)
  for (const channel of Object.keys(handlers) as StrategyChannel[]) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (BrowserWindow.fromWebContents(event.sender) === null) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unrecognized caller' } }
      }
      return handlers[channel](payload)
    })
  }
}
