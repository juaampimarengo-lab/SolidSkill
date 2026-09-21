import { BrowserWindow, ipcMain } from 'electron'
import type { TradeChannel } from '../../shared/ipc/trades'
import type { TradeHandlerDeps } from './tradeHandlers'
import { createTradeHandlers } from './tradeHandlers'

/**
 * Registers exactly the Trading channels, nothing generic. A call is only
 * honoured when it comes from one of this app's own windows.
 */
export function registerTradeIpc(deps: TradeHandlerDeps): void {
  const handlers = createTradeHandlers(deps)
  for (const channel of Object.keys(handlers) as TradeChannel[]) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (BrowserWindow.fromWebContents(event.sender) === null) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unrecognized caller' } }
      }
      return handlers[channel](payload)
    })
  }
}
