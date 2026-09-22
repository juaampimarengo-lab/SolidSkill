import { BrowserWindow, ipcMain } from 'electron'
import type { SettingsChannel } from '../../shared/ipc/settings'
import { SETTINGS_LANGUAGE_SYNC_CHANNEL } from '../../shared/ipc/settings'
import type { SettingsHandlerDeps } from './settingsHandlers'
import { createSettingsHandlers } from './settingsHandlers'

/**
 * Registers the Settings channels, only for this app's own windows, plus one
 * synchronous channel (preload-only) that lets the renderer seed i18next with
 * the correct language before its first paint — see
 * src/shared/ipc/settings.ts for why this one channel is synchronous.
 */
export function registerSettingsIpc(deps: SettingsHandlerDeps): void {
  const handlers = createSettingsHandlers(deps)
  for (const channel of Object.keys(handlers) as SettingsChannel[]) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (BrowserWindow.fromWebContents(event.sender) === null) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unrecognized caller' } }
      }
      return handlers[channel](payload)
    })
  }

  ipcMain.on(SETTINGS_LANGUAGE_SYNC_CHANNEL, (event) => {
    event.returnValue =
      BrowserWindow.fromWebContents(event.sender) === null ? 'en' : deps.service.getLanguage().language
  })
}
