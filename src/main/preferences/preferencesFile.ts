import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * The single small JSON file in userData that holds local app preferences —
 * never trading data, never migrated. Multiple preference stores (active
 * account, language, …) share ONE file, so a write must merge with whatever
 * is already there instead of overwriting the whole file — otherwise setting
 * one preference would silently erase another.
 */
export interface PreferencesFile {
  activeAccountId?: string
  language?: string
}

/** Missing, unreadable, or malformed files all read as "no preferences". */
export function readPreferencesFile(path: string): PreferencesFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) return parsed as PreferencesFile
  } catch {
    // fall through
  }
  return {}
}

export function writePreferencesFile(path: string, patch: PreferencesFile): void {
  const next = { ...readPreferencesFile(path), ...patch }
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(next), 'utf8')
  renameSync(temp, path)
}
