/**
 * DEVELOPMENT-ONLY explicit write gate for the live-staging import.
 *
 * Mechanism: a single fixed request file, polled by the running main process.
 *
 *   <baseDir>/.dev-data/mt5/live-import-request.json   (written by the dev CLI)
 *   <baseDir>/.dev-data/mt5/live-import-result.json    (written here; masked)
 *
 * Why a file and not a socket/IPC: no listener, no port, no renderer surface,
 * and nothing that can carry a command other than the one fixed action. It is
 * NOT started unless (a) the app is unpackaged AND (b) SOLID_SKILL_MT5_DEV_IMPORT=1,
 * so normal startup and reconnect never import. The only thing a request can do is
 * "normalize current receiver staging and import supported completed lifecycles"
 * into the already-open development database. It exposes no DB access, no SQL,
 * no arbitrary commands, and sends nothing to MT5.
 *
 * A request must carry an exact confirmation token, a fresh timestamp (stale
 * files are discarded unexecuted, so a leftover file can never fire at startup)
 * and is consumed (deleted) on read: one file = at most one import.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '../../../persistence'
import { devSnapshotDirectory } from '../devSnapshot'
import { importFromLiveStaging, type LiveStagingSource } from './liveImport'

export const LIVE_IMPORT_REQUEST_FILE = 'live-import-request.json'
export const LIVE_IMPORT_RESULT_FILE = 'live-import-result.json'
export const LIVE_IMPORT_CONFIRMATION = 'WRITE-DEV-DB'
export const LIVE_IMPORT_ACTION = 'import-live-staging'
export const REQUEST_MAX_AGE_MS = 60_000
const POLL_INTERVAL_MS = 1000

export interface LiveImportRequest {
  readonly action: typeof LIVE_IMPORT_ACTION
  readonly confirm: typeof LIVE_IMPORT_CONFIRMATION
  readonly requestId: string
  readonly createdAt: number
  /** Optional masked identity (e.g. "***514") when several accounts are connected. */
  readonly account?: string
}

export interface DevImportGateDeps {
  readonly baseDir: string
  readonly getReceiver: () => LiveStagingSource | null
  readonly getDatabase: () => Database | null
  readonly log: (message: string) => void
  readonly now?: () => number
}

export interface DevImportGate {
  stop(): void
  /** One poll; exposed for tests. */
  pollOnce(): void
}

function writeResult(dir: string, body: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, LIVE_IMPORT_RESULT_FILE), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

function parseRequest(text: string, now: number): { ok: true; request: LiveImportRequest } | { ok: false; message: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'request is not valid JSON' }
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, message: 'request must be an object' }
  const r = raw as Record<string, unknown>
  if (r['action'] !== LIVE_IMPORT_ACTION) return { ok: false, message: 'unknown action' }
  if (r['confirm'] !== LIVE_IMPORT_CONFIRMATION) return { ok: false, message: 'missing confirmation token' }
  if (typeof r['requestId'] !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(r['requestId'])) return { ok: false, message: 'invalid requestId' }
  if (typeof r['createdAt'] !== 'number' || !Number.isFinite(r['createdAt'])) return { ok: false, message: 'invalid createdAt' }
  const age = now - r['createdAt']
  if (age > REQUEST_MAX_AGE_MS || age < -5000) return { ok: false, message: 'request is stale (discarded without importing)' }
  if (r['account'] !== undefined && (typeof r['account'] !== 'string' || !/^\*\*\*[0-9A-Za-z]{3}$/.test(r['account']))) {
    return { ok: false, message: 'invalid masked account selector' }
  }
  return {
    ok: true,
    request: {
      action: LIVE_IMPORT_ACTION,
      confirm: LIVE_IMPORT_CONFIRMATION,
      requestId: r['requestId'],
      createdAt: r['createdAt'],
      ...(typeof r['account'] === 'string' ? { account: r['account'] } : {})
    }
  }
}

export function startDevImportGate(deps: DevImportGateDeps): DevImportGate {
  const dir = devSnapshotDirectory(deps.baseDir)
  const requestPath = join(dir, LIVE_IMPORT_REQUEST_FILE)
  const now = deps.now ?? (() => Date.now())

  const pollOnce = (): void => {
    if (!existsSync(requestPath)) return
    let text: string
    try {
      text = readFileSync(requestPath, 'utf8')
      unlinkSync(requestPath) // consumed: at most one import per file
    } catch {
      return
    }
    const parsed = parseRequest(text, now())
    if (!parsed.ok) {
      deps.log(`MT5 live import request rejected: ${parsed.message}`)
      writeResult(dir, { requestId: null, ok: false, reason: 'REQUEST_REJECTED', message: parsed.message })
      return
    }
    const { request } = parsed
    try {
      const receiver = deps.getReceiver()
      const db = deps.getDatabase()
      if (receiver === null) {
        writeResult(dir, { requestId: request.requestId, ok: false, reason: 'NO_RECEIVER', message: 'the MT5 bridge is not running' })
        return
      }
      if (db === null) {
        writeResult(dir, { requestId: request.requestId, ok: false, reason: 'PERSISTENCE_UNAVAILABLE', message: 'the database is not available' })
        return
      }
      const outcome = importFromLiveStaging(receiver, db, request.account === undefined ? {} : { accountMask: request.account })
      if (outcome.ok) {
        for (const line of outcome.summary.lines) deps.log(line)
        writeResult(dir, { requestId: request.requestId, ok: true, lines: outcome.summary.lines })
      } else {
        deps.log(`MT5 live import refused: ${outcome.reason}: ${outcome.message}`)
        writeResult(dir, { requestId: request.requestId, ok: false, reason: outcome.reason, message: outcome.message })
      }
    } catch {
      deps.log('MT5 live import failed unexpectedly (no details logged: they may contain source identity)')
      writeResult(dir, { requestId: request.requestId, ok: false, reason: 'INTERNAL', message: 'unexpected failure' })
    }
  }

  const timer = setInterval(pollOnce, POLL_INTERVAL_MS)
  timer.unref()
  return { stop: () => clearInterval(timer), pollOnce }
}

/**
 * Starts the gate only for an unpackaged build with SOLID_SKILL_MT5_DEV_IMPORT=1.
 * Otherwise returns null and nothing at all is watched.
 */
export function startDevImportGateFromEnvironment(
  env: NodeJS.ProcessEnv,
  isDevelopment: boolean,
  deps: DevImportGateDeps
): DevImportGate | null {
  if (!isDevelopment || env['SOLID_SKILL_MT5_DEV_IMPORT'] !== '1') return null
  return startDevImportGate(deps)
}
