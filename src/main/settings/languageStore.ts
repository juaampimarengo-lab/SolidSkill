import { readPreferencesFile, writePreferencesFile } from '../preferences/preferencesFile'

/**
 * Local user preference: which language the UI copy is shown in. Presentation
 * state only — see docs/LOCALIZATION.md. Shares preferences.json with the
 * active-account preference via preferencesFile's merge-safe helpers.
 */
export interface LanguageStore {
  read(): string | null
  write(language: string): void
}

export class FileLanguageStore implements LanguageStore {
  constructor(private readonly path: string) {}

  read(): string | null {
    const value = readPreferencesFile(this.path).language
    return typeof value === 'string' && value !== '' ? value : null
  }

  write(language: string): void {
    writePreferencesFile(this.path, { language })
  }
}

export class MemoryLanguageStore implements LanguageStore {
  constructor(private value: string | null = null) {}
  read(): string | null {
    return this.value
  }
  write(language: string): void {
    this.value = language
  }
}
