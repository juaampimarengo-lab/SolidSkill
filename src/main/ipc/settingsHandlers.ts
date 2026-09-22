import type { IpcResult } from '../../shared/ipc/result'
import { SETTINGS_CHANNELS } from '../../shared/ipc/settings'
import type { SettingsChannel } from '../../shared/ipc/settings'
import type { SettingsService } from '../settings/settingsService'
import { ServiceError } from '../serviceError'

export type SettingsHandler = (payload: unknown) => IpcResult<unknown>

export interface SettingsHandlerDeps {
  service: SettingsService
  log: (message: string, error: unknown) => void
}

export function createSettingsHandlers(deps: SettingsHandlerDeps): Record<SettingsChannel, SettingsHandler> {
  function run<T>(fn: (service: SettingsService) => T): IpcResult<T> {
    try {
      return { ok: true, data: fn(deps.service) }
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, error: { code: error.code, message: error.message } }
      deps.log('unexpected error in settings handler', error)
      return { ok: false, error: { code: 'INTERNAL', message: 'An unexpected error occurred.' } }
    }
  }

  const C = SETTINGS_CHANNELS
  return {
    [C.getLanguage]: () => run((s) => s.getLanguage()),
    [C.setLanguage]: (p) => run((s) => s.setLanguage(p))
  }
}
