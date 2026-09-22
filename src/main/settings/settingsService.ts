import { isLanguage, type Language, type SettingsDto } from '../../shared/ipc/settings'
import { ServiceError } from '../serviceError'
import type { LanguageStore } from './languageStore'

/**
 * The UI language preference. Presentation state only (docs/LOCALIZATION.md):
 * no database dependency, no trading data, no broker connection. An absent
 * or invalid remembered value resolves to English, never a blank/error state.
 */
export class SettingsService {
  constructor(private readonly store: LanguageStore) {}

  getLanguage(): SettingsDto {
    return { language: this.resolve() }
  }

  setLanguage(language: unknown): SettingsDto {
    if (!isLanguage(language)) throw new ServiceError('INVALID_INPUT', 'Unsupported language.')
    this.store.write(language)
    return { language }
  }

  private resolve(): Language {
    let stored: string | null
    try {
      stored = this.store.read()
    } catch {
      stored = null
    }
    return isLanguage(stored) ? stored : 'en'
  }
}
