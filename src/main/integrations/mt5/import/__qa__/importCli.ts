/**
 * DEVELOPMENT-ONLY QA CLI for the MT5 Import Service. Never bundled into the
 * application; nothing in src/main/index.ts references it.
 *
 *   --dry-run        (default) normalize the local raw snapshot and report what
 *                    an import WOULD do. The real database file is never
 *                    opened for writing: a throwaway COPY (or an empty
 *                    in-memory database when none exists yet) is used.
 *   --import         Import a NON-pseudonymized (synthetic) snapshot file into the
 *                    development database. Requires --currency AND --confirm-write,
 *                    refuses non-dev targets and REFUSES pseudonymized real captures
 *                    (those are dry-run only; real data uses the live-staging import).
 *   --report         read-only inspection (on a throwaway copy) of imported MT5 accounts;
 *                    --account "***514" selects one by masked identity.
 *   --db <path>      override the target database file.
 *   --snapshot <f>   override the raw snapshot file.
 *
 * Output is counts and masked identity only: no login, server, tickets or
 * per-trade history.
 */
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from '../../../../persistence'
import { devSnapshotDirectory, isPseudonymizedSnapshotAccount, type Mt5DevSnapshot } from '../../devSnapshot'
import { normalizeMt5Deals } from '../../normalizer'
import { buildPersistedReport, sumDecimals } from '../importReport'
import { DEV_PROFILE_DIR, isDevelopmentDatabasePath } from '../liveImport'
import { Mt5ImportService, describeImportResult, mt5AnalyticalDate, type Mt5ImportResult } from '../mt5ImportService'

const DB_FILENAME = 'solid-skill.db'

function defaultDevDbPath(): string {
  const base =
    process.platform === 'win32'
      ? (process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : (process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'))
  return join(base, DEV_PROFILE_DIR, DB_FILENAME)
}

function flag(name: string): boolean {
  return process.argv.includes(name)
}
function option(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function snapshotFiles(): string[] {
  const explicit = option('--snapshot')
  if (explicit !== undefined) return [resolve(explicit)]
  const dir = devSnapshotDirectory(process.cwd())
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith('mt5-raw-') && f.endsWith('.json'))
    .map((f) => join(dir, f))
}

/** Copies a database (and WAL sidecars) to a temp dir so it can be opened without touching the original. */
function openThrowawayCopy(path: string): { db: Database; cleanup: () => void; copied: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'solid-skill-mt5-qa-'))
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true })
  if (!existsSync(path)) return { db: Database.open(':memory:'), cleanup, copied: false }
  const target = join(dir, DB_FILENAME)
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(path + suffix)) copyFileSync(path + suffix, target + suffix)
  }
  return { db: Database.open(target), cleanup, copied: true }
}

const sum = sumDecimals

function printImportResult(r: Mt5ImportResult): void {
  console.log(describeImportResult(r))
  console.log(`  account            : ${r.account.action} (${r.account.displayName})`)
  console.log(`  trades             : created ${r.created.length}, already existing ${r.alreadyExisting.length}, conflicts ${r.conflicts.length}, failed ${r.failed.length}`)
  console.log(`  executions         : ${r.totals.executionsCreated} ${r.dryRun ? 'would be created' : 'created'}`)
  console.log(`  skipped            : open ${r.skippedOpen.length}, unresolved ${r.skippedUnresolved.length}, unsupported ${r.skippedUnsupported.length}`)
  console.log(`  ignored non-trading: ${r.ignoredNonTrading}; rejected deals: ${r.rejectedDeals}; inexact average prices: ${r.inexactAverages}`)
  for (const c of r.conflicts) console.log(`  CONFLICT position ${c.sourcePositionId}: ${c.differences.join(', ')}`)
  for (const f of r.failed) console.log(`  FAILED position ${f.sourcePositionId}: ${f.reason} (${f.message})`)
}

/** What a snapshot would contribute, computed from the normalizer output (aggregates only). */
function printPlanFacts(snapshot: Mt5DevSnapshot): void {
  const result = normalizeMt5Deals(snapshot.deals, snapshot.account)
  const c = result.completed
  const symbols = new Map<string, number>()
  for (const t of c) symbols.set(t.symbol, (symbols.get(t.symbol) ?? 0) + 1)
  const dates = c.map((t) => mt5AnalyticalDate(t.openedAtMsc)).sort()
  console.log('Plan facts (from the normalizer, aggregates only):')
  console.log(`  completed lifecycles: ${c.length}; LONG ${c.filter((t) => t.direction === 'LONG').length}, SHORT ${c.filter((t) => t.direction === 'SHORT').length}`)
  console.log(`  executions          : ${c.reduce((n, t) => n + t.executions.length, 0)}`)
  console.log(`  analytical dates    : ${dates.length === 0 ? 'n/a' : `${dates[0]} .. ${dates[dates.length - 1]} (${new Set(dates).size} distinct)`}; policy = UTC date of the opening deal's DEAL_TIME_MSC as reported (broker server time); no timezone offset assumed`)
  console.log(`  symbols             : ${[...symbols].map(([s, n]) => `${s} x${n}`).join(', ')}`)
  console.log(
    `  totals              : gross ${sum(c.map((t) => t.grossPnl))}, commission ${sum(c.map((t) => t.commission))}, fees ${sum(c.map((t) => t.fees))}, swap ${sum(c.map((t) => t.swap))}, net ${sum(c.map((t) => t.netPnl))}`
  )
  console.log('  strategy            : none assigned (imported trades start with no Strategy)')
}

function printPersistedReport(db: Database): void {
  for (const line of buildPersistedReport(db, option('--account'))) console.log(line)
}

function loadSnapshots(): Mt5DevSnapshot[] {
  const files = snapshotFiles()
  if (files.length === 0) {
    console.log('No MT5 dev snapshot found (.dev-data/mt5 is empty or missing). Nothing to do.')
    process.exit(0)
  }
  return files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as Mt5DevSnapshot)
}

const targetPath = resolve(option('--db') ?? defaultDevDbPath())
const currencyArg = option('--currency')

if (flag('--report')) {
  console.log(`Target database (read-only inspection of a copy): ${targetPath}`)
  if (!existsSync(targetPath)) fail('target database does not exist yet')
  const copy = openThrowawayCopy(targetPath)
  try {
    printPersistedReport(copy.db)
  } finally {
    copy.db.close()
    copy.cleanup()
  }
} else if (flag('--import')) {
  // ---- REAL WRITE: every gate must pass ----
  if (!isDevelopmentDatabasePath(targetPath)) fail(`refusing to write: target is not the ${DEV_PROFILE_DIR} development profile (${targetPath})`)
  if (currencyArg === undefined || !/^[A-Z]{3}$/.test(currencyArg)) {
    fail('a real import needs an explicit account currency: --currency <ISO 4217 code, e.g. USD> (the raw snapshot does not carry it)')
  }
  if (!flag('--confirm-write')) fail('a real import needs --confirm-write. Run the dry run first (npm run qa:mt5-import).')
  // Real captured snapshots are pseudonymized (login/server hashed): importing one would persist an account
  // identity that can never match the live MT5 account. Snapshots are dry-run only; use the live-staging import.
  for (const snapshot of loadSnapshots()) {
    if (isPseudonymizedSnapshotAccount(snapshot.account)) {
      fail('refusing to import a pseudonymized snapshot: snapshots are DRY-RUN ONLY. Use the live-staging import (npm run dev:mt5-live-import) for real data.')
    }
  }
  console.log(`REAL IMPORT into development database: ${targetPath}`)
  console.log('(Close the running app first if it is open; nothing is sent to MT5 - this only reads the local snapshot.)')
  const db = Database.open(targetPath)
  try {
    console.log(`Schema version ${db.health.schemaVersion}; migrations applied on open: ${db.health.migrationsAppliedThisOpen.join(', ') || 'none'}`)
    const service = new Mt5ImportService(db)
    for (const snapshot of loadSnapshots()) {
      const result = service.import(normalizeMt5Deals(snapshot.deals, snapshot.account), { currency: currencyArg })
      printImportResult(result)
    }
    printPersistedReport(db)
  } finally {
    db.close()
  }
} else {
  // ---- DRY RUN (default): nothing is written to the real database ----
  console.log('DRY RUN - nothing is written to the real database.')
  console.log(`Target database: ${targetPath}`)
  const copy = openThrowawayCopy(targetPath)
  console.log(copy.copied ? 'Reconciling against a throwaway COPY of the existing database.' : 'Target does not exist yet: reconciling against an empty in-memory database.')
  try {
    const service = new Mt5ImportService(copy.db)
    for (const snapshot of loadSnapshots()) {
      printPlanFacts(snapshot)
      const result = service.import(normalizeMt5Deals(snapshot.deals, snapshot.account), {
        currency: currencyArg ?? 'XXX',
        dryRun: true
      })
      printImportResult(result)
      if (currencyArg === undefined) console.log('  (currency is not in the snapshot; a real import requires --currency)')
    }
  } finally {
    copy.db.close()
    copy.cleanup()
  }
}

