import { BrowserWindow } from 'electron'
import { TRADE_DATA_CHANGED_CHANNEL, type TradingDataChangedDto } from '../../shared/ipc/trades'

/**
 * Pushes a `TradingDataChangedDto` to every open renderer window. Used only
 * after automatic MT5 reconciliation persists new Trades (Checkpoint
 * 012B-4). Never carries raw MT5 identity; the DTO type enforces that.
 */
export function notifyTradingDataChanged(event: TradingDataChangedDto): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(TRADE_DATA_CHANGED_CHANNEL, event)
  }
}
