/**
 * Real Tradovate connectivity / structural QA capture (013B). Development
 * tooling only — invoked via `npm run dev:tradovate-real-qa`
 * (`scripts/tradovate-real-qa.mjs`), never from the running app or any IPC
 * path. Uses ONLY the adapter boundary (`TradovateAdapter`); never talks to
 * `HttpTradovateTransport` directly.
 *
 * ABSOLUTE GUARANTEE: this module imports nothing from
 * `src/main/persistence` or `src/main/trading` — there is no code path by
 * which anything captured here can reach SQLite. It prints a structural
 * report (counts/shapes, masked account id) and, when real fills were
 * captured, writes ONE pseudonymized snapshot file under
 * `.dev-data/tradovate/` (gitignored) for local normalizer QA. Nothing is
 * persisted anywhere else.
 */
import { TradovateAdapter, type TradovateAdapterEvent } from './adapter'
import { describeMissingTradovateEnv, loadTradovateCredentialsFromEnv, maskTradovateCredentialName } from './credentials'
import { buildTradovateDevSnapshot, writeTradovateDevSnapshot } from './devSnapshot'
import { normalizeTradovateFills } from './normalizer'
import { buildTradovateStructuralReport, formatTradovateStructuralReport, maskTradovateAccountId } from './structuralReport'
import { HttpTradovateTransport } from './realTransport'

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

export async function runTradovateRealQa(env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const { credentials, environment, missing } = loadTradovateCredentialsFromEnv(env)

  if (credentials === null) {
    log('BLOCKED: real Tradovate connectivity was not attempted.')
    for (const line of describeMissingTradovateEnv(missing)) log(line)
    return 0
  }

  log(`Connecting to Tradovate (${environment}) as ${maskTradovateCredentialName(credentials.name)}...`)
  const transport = new HttpTradovateTransport({ environment })
  const events: TradovateAdapterEvent[] = []
  const adapter = new TradovateAdapter({ transport, onEvent: (e) => events.push(e) })

  try {
    await adapter.connect(credentials)
  } catch (error) {
    log(`AUTH FAILED: ${error instanceof Error ? error.message : 'unknown error'}`)
    return 1
  }
  log('Authenticated.')

  let accounts
  try {
    accounts = await adapter.listAccounts()
  } catch (error) {
    log(`account/list FAILED: ${error instanceof Error ? error.message : 'unknown error'}`)
    await adapter.disconnect()
    return 1
  }
  log(`accounts found: ${accounts.length}`)
  if (accounts.length === 0) {
    await adapter.disconnect()
    return 0
  }

  const range = { fromTimestamp: '2000-01-01T00:00:00.000Z', toTimestamp: new Date().toISOString() }

  for (const account of accounts) {
    const masked = maskTradovateAccountId(account.id)
    log(`\n--- account ${masked} ---`)

    const results = await Promise.allSettled([
      adapter.getHistoricalSourceFacts(account.id, range),
      adapter.listPositions(account.id),
      adapter.listFillPairs(account.id)
    ])
    const [fillsResult, positionsResult, fillPairsResult] = results
    const fills = fillsResult.status === 'fulfilled' ? fillsResult.value : []
    const positions = positionsResult.status === 'fulfilled' ? positionsResult.value : []
    const fillPairs = fillPairsResult.status === 'fulfilled' ? fillPairsResult.value : []
    for (const [name, r] of [
      ['fill/list', fillsResult],
      ['position/list', positionsResult],
      ['fillPair/list', fillPairsResult]
    ] as const) {
      if (r.status === 'rejected') log(`${name}: FAILED — ${r.reason instanceof Error ? r.reason.message : 'unknown error'}`)
    }

    let fillFees: Awaited<ReturnType<typeof adapter.listFillFees>> = []
    try {
      fillFees = await adapter.listFillFees(fills.map((f) => f.fillId))
    } catch (error) {
      log(`fillFee/deps: FAILED — ${error instanceof Error ? error.message : 'unknown error'}`)
    }

    const normalization = normalizeTradovateFills(fills, { accountId: account.id })
    const report = buildTradovateStructuralReport(account.id, accounts.length, fills, positions, fillPairs, fillFees, normalization)
    for (const line of formatTradovateStructuralReport(report)) log(line)

    if (fills.length > 0) {
      const snapshot = buildTradovateDevSnapshot(environment, account.id, fills, positions, fillPairs, fillFees, new Date().toISOString())
      const path = writeTradovateDevSnapshot(cwd, snapshot)
      log(`snapshot written: ${path} (pseudonymized; gitignored)`)
    }
  }

  await adapter.disconnect()
  log(`\nevents: ${events.map((e) => e.kind).join(', ')}`)
  return 0
}
