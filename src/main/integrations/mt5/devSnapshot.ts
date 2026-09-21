/**
 * DEVELOPMENT-ONLY export of the in-memory raw staging for normalization QA.
 *
 * - Opt-in (SOLID_SKILL_MT5_DEV_SNAPSHOT=1) AND only when the app is not
 *   packaged; wired by startMt5BridgeFromEnvironment. Never reachable from the
 *   renderer, never exposed through IPC.
 * - Writes ONLY to <cwd>/.dev-data/mt5/mt5-raw-<pseudonym>.json (gitignored).
 *   No path, filename, or content is ever taken from MT5.
 * - Account login and server are replaced by stable one-way pseudonyms and
 *   free-text externalId is dropped. Tickets, times, prices are kept so the
 *   structure can be analysed locally; the file is private and never committed.
 * - Contains no credentials (the receiver never stores any).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { PositionAccounting, RawMt5Deal } from './protocol'
import type { Mt5Receiver } from './receiver'

export const DEV_SNAPSHOT_FORMAT_VERSION = 1

export interface Mt5DevSnapshot {
  readonly formatVersion: typeof DEV_SNAPSHOT_FORMAT_VERSION
  readonly capturedAt: string
  readonly account: { readonly server: string; readonly accountLogin: string; readonly accounting: PositionAccounting | null }
  readonly deals: readonly RawMt5Deal[]
}

function hashHex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Digits-only so the pseudonym still looks like an unsigned login. */
export function pseudonymLogin(login: string): string {
  return BigInt(`0x${hashHex(`login:${login}`).slice(0, 12)}`).toString()
}
export function pseudonymServer(server: string): string {
  return `server-${hashHex(`server:${server}`).slice(0, 8)}`
}

export function buildDevSnapshot(
  account: { server: string; login: string; accounting: PositionAccounting | null },
  deals: readonly RawMt5Deal[],
  capturedAt: string
): Mt5DevSnapshot {
  const server = pseudonymServer(account.server)
  const accountLogin = pseudonymLogin(account.login)
  return {
    formatVersion: DEV_SNAPSHOT_FORMAT_VERSION,
    capturedAt,
    account: { server, accountLogin, accounting: account.accounting },
    deals: deals
      .filter((d) => d.server === account.server && d.accountLogin === account.login)
      .map((d) => ({ ...d, server, accountLogin, externalId: null }))
  }
}

export function devSnapshotDirectory(baseDir: string): string {
  return resolve(baseDir, '.dev-data', 'mt5')
}

/** Writes one file per account; returns the written file paths. */
export function writeDevSnapshots(receiver: Mt5Receiver, baseDir: string, now: () => Date = () => new Date()): string[] {
  const dir = devSnapshotDirectory(baseDir)
  mkdirSync(dir, { recursive: true })
  const staged = receiver.getStagedDeals().map((s) => s.deal)
  const written: string[] = []
  for (const account of receiver.getStatus().accounts) {
    const snapshot = buildDevSnapshot(
      { server: account.server, login: account.login, accounting: account.positionAccounting },
      staged,
      now().toISOString()
    )
    const file = join(dir, `mt5-raw-${snapshot.account.accountLogin}.json`)
    writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    written.push(file)
  }
  return written
}
