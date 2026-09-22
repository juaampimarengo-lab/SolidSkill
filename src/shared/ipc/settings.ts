/**
 * Settings IPC contract (Checkpoint 012C). Presentation-only preference:
 * which language the UI copy is shown in. See docs/LOCALIZATION.md. Never
 * touches trading data, the database, or a broker/platform connection.
 */

import type { IpcResult } from './result'

export const LANGUAGES = ['en', 'es'] as const
export type Language = (typeof LANGUAGES)[number]

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

export interface SettingsDto {
  language: Language
}

export interface SettingsApi {
  getLanguage(): Promise<IpcResult<SettingsDto>>
  /** Remembers the choice locally. Presentation state only. */
  setLanguage(language: Language): Promise<IpcResult<SettingsDto>>
}

export const SETTINGS_CHANNELS = {
  getLanguage: 'settings:getLanguage',
  setLanguage: 'settings:setLanguage'
} as const

export type SettingsChannel = (typeof SETTINGS_CHANNELS)[keyof typeof SETTINGS_CHANNELS]

/**
 * Preload-only synchronous channel: read once, before the renderer's first
 * paint, so the initial language is correct immediately and there is no
 * flash back to English while the async settings API resolves. Never
 * exposed to renderer code directly — see src/preload/index.ts.
 */
export const SETTINGS_LANGUAGE_SYNC_CHANNEL = 'settings:getLanguageSync'
