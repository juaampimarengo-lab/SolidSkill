/**
 * Localization smoke suite (Checkpoint 012C, docs/LOCALIZATION.md). Development
 * tooling only — not imported by the application. Run with `npm run smoke:i18n`.
 * It runs inside the real Electron main-process runtime (see scripts/i18n-smoke.mjs)
 * and covers:
 *   - the preferences.json merge-safety fix (activeAccountId and language must
 *     coexist without clobbering each other)
 *   - SettingsService validation / fallback-to-English behaviour
 *   - the settings IPC handlers' envelope
 *   - EN/ES resource key parity (every namespace, every key, both locales)
 *   - i18next's runtime fallback: a missing Spanish key resolves to its
 *     English copy, never a blank string and never the raw key
 */
import { app } from 'electron'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import i18next from 'i18next'
import { readPreferencesFile, writePreferencesFile } from '../../preferences/preferencesFile'
import { FileActiveAccountStore } from '../../accounts/activeAccountStore'
import { FileLanguageStore, MemoryLanguageStore } from '../languageStore'
import { SettingsService } from '../settingsService'
import { createSettingsHandlers } from '../../ipc/settingsHandlers'
import { SETTINGS_CHANNELS, LANGUAGES, isLanguage } from '../../../shared/ipc/settings'
import type { IpcResult } from '../../../shared/ipc/result'

import enCommon from '../../../renderer/src/i18n/locales/en/common.json'
import enShell from '../../../renderer/src/i18n/locales/en/shell.json'
import enStrategy from '../../../renderer/src/i18n/locales/en/strategy.json'
import enAccounts from '../../../renderer/src/i18n/locales/en/accounts.json'
import enJournal from '../../../renderer/src/i18n/locales/en/journal.json'
import esCommon from '../../../renderer/src/i18n/locales/es/common.json'
import esShell from '../../../renderer/src/i18n/locales/es/shell.json'
import esStrategy from '../../../renderer/src/i18n/locales/es/strategy.json'
import esAccounts from '../../../renderer/src/i18n/locales/es/accounts.json'
import esJournal from '../../../renderer/src/i18n/locales/es/journal.json'

const outFile = process.env['SMOKE_OUT']
if (outFile !== undefined) writeFileSync(outFile, '')

let passed = 0
let failed = 0
function log(line: string): void {
  if (outFile !== undefined) appendFileSync(outFile, `${line}\n`)
  else console.log(line)
}
function check(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
function equal<T>(actual: T, expected: T, label = 'value'): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`)
}
function throws(fn: () => unknown, pattern: RegExp): void {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!pattern.test(message)) throw new Error(`threw "${message}", expected ${pattern}`)
    return
  }
  throw new Error(`expected an error matching ${pattern}, but nothing was thrown`)
}

const workDir = mkdtempSync(join(tmpdir(), 'solid-skill-i18n-smoke-'))

// ---- preferences.json merge-safety -----------------------------------------
check('preferences file: an unrelated key write never clobbers an existing one', () => {
  const path = join(workDir, 'preferences.json')
  writePreferencesFile(path, { activeAccountId: 'acct-1' })
  writePreferencesFile(path, { language: 'es' })
  equal(readPreferencesFile(path), { activeAccountId: 'acct-1', language: 'es' })
  writePreferencesFile(path, { activeAccountId: 'acct-2' })
  equal(readPreferencesFile(path), { activeAccountId: 'acct-2', language: 'es' }, 'language survives an account switch')
})

check('FileActiveAccountStore and FileLanguageStore coexist on the same preferences.json', () => {
  const path = join(workDir, 'shared-preferences.json')
  const accountStore = new FileActiveAccountStore(path)
  const languageStore = new FileLanguageStore(path)
  accountStore.write('acct-9')
  languageStore.write('es')
  equal(accountStore.read(), 'acct-9')
  equal(languageStore.read(), 'es')
  accountStore.write('acct-10')
  equal(languageStore.read(), 'es', 'account write did not erase language')
  languageStore.write('en')
  equal(accountStore.read(), 'acct-10', 'language write did not erase account')
})

check('missing / unreadable / malformed preferences file reads as no preference', () => {
  const path = join(workDir, 'missing.json')
  equal(new FileLanguageStore(path).read(), null)
  equal(new FileActiveAccountStore(path).read(), null)
})

// ---- SettingsService --------------------------------------------------------
check('SettingsService: default language is English', () => {
  equal(new SettingsService(new MemoryLanguageStore()).getLanguage(), { language: 'en' })
})

check('SettingsService: an invalid remembered locale falls back to English', () => {
  equal(new SettingsService(new MemoryLanguageStore('fr')).getLanguage(), { language: 'en' })
  equal(new SettingsService(new MemoryLanguageStore('')).getLanguage(), { language: 'en' })
})

check('SettingsService: setLanguage persists and round-trips', () => {
  const store = new MemoryLanguageStore()
  const svc = new SettingsService(store)
  equal(svc.setLanguage('es'), { language: 'es' })
  equal(svc.getLanguage(), { language: 'es' })
  equal(store.read(), 'es')
})

check('SettingsService: setLanguage rejects anything outside en/es', () => {
  const svc = new SettingsService(new MemoryLanguageStore())
  throws(() => svc.setLanguage('fr'), /Unsupported language/)
  throws(() => svc.setLanguage(''), /Unsupported language/)
  throws(() => svc.setLanguage(null), /Unsupported language/)
})

check('language preference survives restart (reopened file store)', () => {
  const path = join(workDir, 'restart-preferences.json')
  new SettingsService(new FileLanguageStore(path)).setLanguage('es')
  equal(new SettingsService(new FileLanguageStore(path)).getLanguage(), { language: 'es' }, 'fresh service instance re-reads the file')
})

// ---- IPC handlers ------------------------------------------------------------
check('settings IPC handlers: get/set round trip and validate input', () => {
  const service = new SettingsService(new MemoryLanguageStore())
  const handlers = createSettingsHandlers({ service, log: () => undefined })
  const get = handlers[SETTINGS_CHANNELS.getLanguage](undefined) as IpcResult<{ language: string }>
  equal(get, { ok: true, data: { language: 'en' } })
  const set = handlers[SETTINGS_CHANNELS.setLanguage]('es') as IpcResult<{ language: string }>
  equal(set, { ok: true, data: { language: 'es' } })
  const invalid = handlers[SETTINGS_CHANNELS.setLanguage]('fr') as IpcResult<unknown>
  equal(invalid.ok, false)
  if (!invalid.ok) equal(invalid.error.code, 'INVALID_INPUT')
})

check('isLanguage guards exactly {en, es}', () => {
  equal(LANGUAGES, ['en', 'es'])
  equal(isLanguage('en'), true)
  equal(isLanguage('es'), true)
  equal(isLanguage('fr'), false)
  equal(isLanguage(undefined), false)
  equal(isLanguage(42), false)
})

// ---- resource parity ---------------------------------------------------------
type Tree = Record<string, unknown>
function keyPaths(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v as Tree, path) : [path]
  })
}

const namespaces: Array<[string, Tree, Tree]> = [
  ['common', enCommon, esCommon],
  ['shell', enShell, esShell],
  ['strategy', enStrategy, esStrategy],
  ['accounts', enAccounts, esAccounts],
  ['journal', enJournal, esJournal]
]

for (const [ns, en, es] of namespaces) {
  check(`i18n resources: ${ns} has identical EN/ES key sets (no silent gaps)`, () => {
    const enKeys = keyPaths(en).sort()
    const esKeys = keyPaths(es).sort()
    equal(esKeys, enKeys, `${ns} keys`)
  })
  check(`i18n resources: ${ns} has no empty string values in either locale`, () => {
    for (const [locale, tree] of [['en', en] as const, ['es', es] as const]) {
      for (const path of keyPaths(tree)) {
        const value = path.split('.').reduce<unknown>((o, k) => (o as Tree)[k], tree)
        if (value === '') throw new Error(`${ns}.${path} (${locale}) is an empty string`)
      }
    }
  })
}

// ---- runtime fallback: missing Spanish key resolves to English --------------
check('i18next: default locale is English', async () => {
  const inst = i18next.createInstance()
  await inst.init({
    resources: { en: { common: enCommon }, es: { common: esCommon } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common'
  })
  equal(inst.t('retry'), enCommon.retry)
})

check('i18next: switching to Spanish updates copy, switching back restores English', async () => {
  const inst = i18next.createInstance()
  await inst.init({
    resources: { en: { common: enCommon }, es: { common: esCommon } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common'
  })
  equal(inst.t('retry'), enCommon.retry)
  await inst.changeLanguage('es')
  equal(inst.t('retry'), esCommon.retry)
  await inst.changeLanguage('en')
  equal(inst.t('retry'), enCommon.retry)
})

check('i18next: a missing Spanish key falls back to English, never blank, never the raw key', async () => {
  const esWithGap: Tree = JSON.parse(JSON.stringify(esStrategy))
  delete (esWithGap['overview'] as Tree)['definition']
  const inst = i18next.createInstance()
  await inst.init({
    resources: { en: { strategy: enStrategy }, es: { strategy: esWithGap } },
    lng: 'es',
    fallbackLng: 'en',
    ns: ['strategy'],
    defaultNS: 'strategy',
    returnEmptyString: false
  })
  const value = inst.t('overview.definition')
  equal(value, enStrategy.overview.definition, 'falls back to the English copy')
  equal(value === '', false)
  equal(value === 'overview.definition', false, 'never shows the raw key')
})

check('i18next: canonical trading terminology is passed through unchanged (never routed through t())', () => {
  // Win Rate / P&L / LONG / SHORT / PASS / FAIL / N/A / UNREVIEWED never appear as
  // translation keys — they are literal strings in the components, by design.
  const flatEn = JSON.stringify([enCommon, enShell, enStrategy, enAccounts])
  for (const literal of ['Win Rate', 'LONG', 'SHORT', 'UNREVIEWED']) {
    equal(flatEn.includes(literal), false, `"${literal}" must never be a translation resource value`)
  }
})

rmSync(workDir, { recursive: true, force: true })
log(`\n${passed} passed, ${failed} failed`)
app.exit(failed === 0 ? 0 : 1)
