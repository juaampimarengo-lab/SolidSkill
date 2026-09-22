/**
 * Tradovate read-only adapter/normalizer smoke suite. Needs no real
 * Tradovate account or credentials: a fake transport speaks the adapter's
 * interface, and synthetic fixtures drive the normalizer.
 * Run with: npm run smoke:tradovate
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { TradovateAdapter, type TradovateAdapterEvent } from '../adapter'
import { FakeTradovateTransport } from '../fakeTransport'
import { TradovateRawStaging } from '../rawStaging'
import { rawFillIdentity, rawFillPairIdentity, rawFillFeeIdentity, rawPositionIdentity, canonicalizeDecimal, type RawTradovateAccount } from '../protocol'
import { normalizeTradovateFills } from '../normalizer'
import type { TradovateTransport, TradovateSession } from '../transport'
import { HttpTradovateTransport, TradovateAuthError, TradovateRateLimitError, TradovateMalformedPayloadError } from '../realTransport'
import { loadTradovateCredentialsFromEnv, describeMissingTradovateEnv, maskTradovateCredentialName } from '../credentials'
import { maskTradovateAccountId } from '../structuralReport'
import { devSnapshotDirectory } from '../devSnapshot'
import {
  ACCOUNT_A,
  ACCOUNT_B,
  CONTRACT_ES,
  CONTRACT_MNQ,
  CONTRACT_IDENTITY_PRESERVED,
  COMPLETED_ROUND_TRIP_THEN_REVERSAL,
  MULTI_FILL_ONE_ORDER,
  OPEN_LIFECYCLE,
  OUT_OF_ORDER,
  PARTIAL_EXIT_STAYS_OPEN,
  REPLAY_CONFLICTING,
  REPLAY_IDENTICAL,
  REVERSAL_LONG_TO_SHORT,
  REVERSAL_SHORT_TO_LONG,
  SAME_TIMESTAMP,
  SCALE_IN_PARTIAL_OUT,
  SIMPLE_LONG,
  SIMPLE_SHORT,
  TWO_ACCOUNTS_SAME_CONTRACT,
  TWO_INSTRUMENTS_ONE_ACCOUNT,
  TWO_ROUND_TRIPS_SAME_ACCOUNT_AND_CONTRACT,
  fillFee,
  fillPair,
  position
} from './fixtures'

let passed = 0
let failed = 0
const lines: string[] = []

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body()
    passed += 1
    lines.push(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    lines.push(`FAIL  ${name}\n        ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Walks every .ts file under a directory, calling `visit(fullPath, contents)`. Shared by all static-scan tests. */
function walkTsFiles(dir: string, visit: (fullPath: string, text: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) walkTsFiles(full, visit)
    else if (entry.isFile() && entry.name.endsWith('.ts')) visit(full, readFileSync(full, 'utf8'))
  }
}

function fakeJsonFetch(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (key: string) => headers[key] ?? null },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    }) as unknown as Response) as unknown as typeof fetch
}

const FAKE_SESSION: TradovateSession = { accessToken: 'fake-token', mdAccessToken: null, expiresAtMsc: Date.now() + 60_000, userId: 'user-1' }

const FAKE_ACCOUNT_A: RawTradovateAccount = {
  id: ACCOUNT_A,
  name: 'Fake Account A',
  userId: 'user-1',
  accountType: 'Demo',
  active: true,
  clearingHouseId: null,
  legalStatus: null
}

async function main(): Promise<void> {
  // ------------------------------------------------------------------ adapter (read-only interface)
  await check('adapter: connect -> listAccounts -> getHistoricalSourceFacts -> disconnect', async () => {
    const events: TradovateAdapterEvent[] = []
    const transport = new FakeTradovateTransport({ accounts: [FAKE_ACCOUNT_A], history: SIMPLE_LONG })
    const adapter = new TradovateAdapter({ transport, onEvent: (e) => events.push(e) })
    await adapter.connect({ name: 'demo', password: 'x', appId: 'app', appVersion: '1.0', cid: 'cid', sec: 'sec' })
    const accounts = await adapter.listAccounts()
    equal(accounts, [FAKE_ACCOUNT_A], 'accounts returned')
    const fills = await adapter.getHistoricalSourceFacts(ACCOUNT_A, { fromTimestamp: '2000-01-01T00:00:00.000Z', toTimestamp: '2100-01-01T00:00:00.000Z' })
    assert(fills.length === 2, 'expected 2 staged fills')
    await adapter.disconnect()
    assert(events.some((e) => e.kind === 'connected'), 'connected event fired')
    assert(events.some((e) => e.kind === 'history_synced'), 'history_synced event fired')
    assert(events.some((e) => e.kind === 'disconnected'), 'disconnected event fired')
    equal(transport.diagnostics.disconnectCalls, 1, 'transport disconnected once')
  })

  await check('adapter: auth failure surfaces auth_error and rethrows, no session created', async () => {
    const events: TradovateAdapterEvent[] = []
    const transport = new FakeTradovateTransport({ accounts: [], rejectAuth: true })
    const adapter = new TradovateAdapter({ transport, onEvent: (e) => events.push(e) })
    let threw = false
    try {
      await adapter.connect({ name: 'x', password: 'x', appId: 'a', appVersion: '1', cid: 'c', sec: 's' })
    } catch {
      threw = true
    }
    assert(threw, 'connect should reject')
    assert(events.some((e) => e.kind === 'auth_error'), 'auth_error event fired')
    let threwOnListAccounts = false
    try {
      await adapter.listAccounts()
    } catch {
      threwOnListAccounts = true
    }
    assert(threwOnListAccounts, 'listAccounts before a session must throw, never silently succeed')
  })

  await check('adapter: live subscription stages fills through the same path as history', async () => {
    const transport = new FakeTradovateTransport({ accounts: [FAKE_ACCOUNT_A] })
    const events: TradovateAdapterEvent[] = []
    const adapter = new TradovateAdapter({ transport, onEvent: (e) => events.push(e) })
    await adapter.connect({ name: 'demo', password: 'x', appId: 'app', appVersion: '1.0', cid: 'cid', sec: 'sec' })
    adapter.subscribeToSourceFacts(ACCOUNT_A)
    transport.emitLiveFill(SIMPLE_LONG[0] as (typeof SIMPLE_LONG)[number])
    const staged = adapter.getStagedFills(ACCOUNT_A)
    assert(staged.length === 1, 'live fill staged')
    assert(events.some((e) => e.kind === 'live_fill_staged' && e.outcome === 'accepted'), 'live_fill_staged accepted event fired')
    adapter.unsubscribeFromSourceFacts(ACCOUNT_A)
    transport.emitLiveFill(SIMPLE_LONG[1] as (typeof SIMPLE_LONG)[number])
    assert(adapter.getStagedFills(ACCOUNT_A).length === 1, 'no fill staged after unsubscribe')
    await adapter.disconnect()
  })

  // ------------------------------------------------------------------ 22. no trading capability
  await check('22. no trading/write method exists anywhere in the tradovate integration source', () => {
    const dir = resolve('src/main/integrations/tradovate')
    const forbidden = [
      /\bplaceOrder\s*\(/i,
      /\bcancelOrder\s*\(/i,
      /\bcancelAllOrders\s*\(/i,
      /\bmodifyOrder\s*\(/i,
      /\bmodifyPosition\s*\(/i,
      /\bflattenPosition\s*\(/i,
      /\bliquidatePosition\s*\(/i,
      /\bsendOrder\s*\(/i,
      /\bexecuteOrder\s*\(/i,
      /order\/placeorder/i,
      /order\/cancelorder/i,
      /order\/modifyorder/i,
      /position\/flattenposition/i,
      /position\/liquidateposition/i
    ]
    const violations: string[] = []
    walkTsFiles(dir, (full, text) => {
      for (const pattern of forbidden) {
        if (pattern.test(text)) violations.push(`${full}: matches ${pattern}`)
      }
    })
    assert(violations.length === 0, `forbidden trading capability found: ${violations.join('; ')}`)
  })

  // ------------------------------------------------------------------ 013B: real-transport boundary requirements
  await check('token/password/secret values are never passed to a logging call anywhere in the integration source', () => {
    const dir = resolve('src/main/integrations/tradovate')
    const forbidden = [/console\.(log|error|warn|info)\([^)]*\b(password|accessToken|\.sec\b|credentials\.sec)\b/i]
    const violations: string[] = []
    walkTsFiles(dir, (full, text) => {
      for (const pattern of forbidden) if (pattern.test(text)) violations.push(`${full}: matches ${pattern}`)
    })
    assert(violations.length === 0, `credential/token value passed to a log call: ${violations.join('; ')}`)
  })

  await check('account identity masking never reveals the full account id or credential name', () => {
    equal(maskTradovateAccountId('1234567'), '***567', 'account id masked to last 3 chars')
    equal(maskTradovateCredentialName('trader1'), '***er1', 'credential name masked to last 3 chars')
    equal(maskTradovateCredentialName('ab'), '***', 'very short name is fully masked, never partially exposed')
  })

  await check('credential loader reports missing env var NAMES only, and never returns a partial credential object', () => {
    const result = loadTradovateCredentialsFromEnv({})
    assert(result.credentials === null, 'no credentials when required vars are missing')
    equal(result.missing.length, 6, 'all six required vars reported missing')
    assert(result.missing.every((m) => m.startsWith('SOLID_SKILL_TRADOVATE_')), 'missing entries are env var names, not values')
    const guidance = describeMissingTradovateEnv(result.missing).join('\n')
    assert(!guidance.includes('undefined') && guidance.length > 0, 'guidance is human-readable and contains no leaked undefined value')
  })

  await check('credential loader resolves full credentials only when every required var is present', () => {
    const env = {
      SOLID_SKILL_TRADOVATE_NAME: 'trader1',
      SOLID_SKILL_TRADOVATE_PASSWORD: 'secret',
      SOLID_SKILL_TRADOVATE_APP_ID: 'app',
      SOLID_SKILL_TRADOVATE_APP_VERSION: '1.0',
      SOLID_SKILL_TRADOVATE_CID: 'cid',
      SOLID_SKILL_TRADOVATE_SEC: 'sec'
    }
    const result = loadTradovateCredentialsFromEnv(env)
    assert(result.credentials !== null, 'credentials resolved when all six are set')
    equal(result.missing, [], 'nothing missing')
    equal(result.environment, 'demo', 'defaults to demo when SOLID_SKILL_TRADOVATE_ENVIRONMENT is unset')
  })

  await check('401/403 from Tradovate is handled explicitly as TradovateAuthError, never a generic crash', async () => {
    for (const status of [401, 403]) {
      const transport = new HttpTradovateTransport({ environment: 'demo', fetchImpl: fakeJsonFetch(status, {}) })
      let threw = false
      try {
        await transport.listAccounts(FAKE_SESSION)
      } catch (error) {
        threw = error instanceof TradovateAuthError
      }
      assert(threw, `HTTP ${status} must throw TradovateAuthError`)
    }
  })

  await check('a 429 rate-limit response is handled safely, never retried in a loop, Retry-After preserved', async () => {
    const transport = new HttpTradovateTransport({ environment: 'demo', fetchImpl: fakeJsonFetch(429, '', { 'Retry-After': '30' }) })
    let error: unknown = null
    try {
      await transport.listAccounts(FAKE_SESSION)
    } catch (e) {
      error = e
    }
    assert(error instanceof TradovateRateLimitError, 'rate limit surfaces as TradovateRateLimitError')
    equal((error as TradovateRateLimitError).retryAfterSeconds, 30, 'Retry-After header value is preserved')
  })

  await check('a malformed (non-JSON) payload is rejected explicitly, never partially parsed', async () => {
    const transport = new HttpTradovateTransport({ environment: 'demo', fetchImpl: fakeJsonFetch(200, 'this is not json') })
    let threw = false
    try {
      await transport.listAccounts(FAKE_SESSION)
    } catch (error) {
      threw = error instanceof TradovateMalformedPayloadError
    }
    assert(threw, 'non-JSON body must throw TradovateMalformedPayloadError')
  })

  await check('a well-formed but shape-wrong payload (object instead of array) is rejected explicitly', async () => {
    const transport = new HttpTradovateTransport({ environment: 'demo', fetchImpl: fakeJsonFetch(200, { unexpected: true }) })
    let threw = false
    try {
      await transport.listAccounts(FAKE_SESSION)
    } catch (error) {
      threw = error instanceof TradovateMalformedPayloadError
    }
    assert(threw, 'non-array account/list body must throw TradovateMalformedPayloadError')
  })

  await check('a raw network failure is normalized to an Error and never hangs or leaks a raw thrown value', async () => {
    const fetchImpl = (async () => {
      throw 'raw string throw with sensitive-looking text p@ssw0rd'
    }) as unknown as typeof fetch
    const transport = new HttpTradovateTransport({ environment: 'demo', fetchImpl })
    let caught: unknown = null
    try {
      await transport.listAccounts(FAKE_SESSION)
    } catch (e) {
      caught = e
    }
    assert(caught instanceof Error, 'a raw thrown value is normalized to an Error instance')
    assert(caught instanceof Error && !caught.message.includes('p@ssw0rd'), 'the raw thrown value text is not passed through verbatim')
  })

  await check('real transport account isolation: listOrders/listPositions filter strictly by accountId', async () => {
    const orders = [
      { id: 'o1', accountId: ACCOUNT_A, action: 'Buy', ordStatus: 'Filled', timestamp: '2026-01-01T00:00:00.000Z', contractId: CONTRACT_MNQ },
      { id: 'o2', accountId: ACCOUNT_B, action: 'Sell', ordStatus: 'Filled', timestamp: '2026-01-01T00:00:00.000Z', contractId: CONTRACT_MNQ }
    ]
    const transport = new HttpTradovateTransport({ environment: 'demo', fetchImpl: fakeJsonFetch(200, orders) })
    const result = await transport.listOrders(FAKE_SESSION, ACCOUNT_A)
    equal(result.length, 1, 'only the requested account\'s orders are returned')
    equal(result[0]?.id, 'o1', 'correct order returned')
  })

  await check('real transport can be replaced by fake transport: identical adapter behavior over the same TradovateTransport contract', async () => {
    const tokenResponse = { accessToken: 'tok-1', expirationTime: new Date(Date.now() + 80 * 60 * 1000).toISOString(), userId: 'user-9' }
    const accountsResponse = [{ id: ACCOUNT_A, name: 'Real Account', userId: 'user-9', accountType: 'Demo', active: true, clearingHouseId: null, legalStatus: null }]
    let call = 0
    const sequence = [tokenResponse, accountsResponse]
    const fetchImpl = (async () => {
      const body = sequence[call]
      call += 1
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(body) } as unknown as Response
    }) as unknown as typeof fetch

    const httpTransport: TradovateTransport = new HttpTradovateTransport({ environment: 'demo', fetchImpl })
    const fakeTransportInstance: TradovateTransport = new FakeTradovateTransport({ accounts: [FAKE_ACCOUNT_A] })
    for (const transport of [httpTransport, fakeTransportInstance]) {
      const adapter = new TradovateAdapter({ transport })
      await adapter.connect({ name: 'demo', password: 'x', appId: 'a', appVersion: '1', cid: 'c', sec: 's' })
      const accounts = await adapter.listAccounts()
      assert(accounts.length === 1, 'each transport implementation returns one account through the identical adapter API')
    }
  })

  await check('no non-test file under the tradovate integration imports a database/write-capable persistence module', () => {
    // fixedPoint.ts is a pure decimal-math helper (no SQLite) shared with MT5's normalizer and
    // is explicitly allowed; the actual write-capable surface is database.ts/sql.ts/migrations/repositories.
    const dir = resolve('src/main/integrations/tradovate')
    const forbidden = [
      /from ['"].*\/persistence\/(database|sql|migrations|repositories)/i,
      /from ['"].*\/trading\//i,
      /['"]node:sqlite['"]/
    ]
    const violations: string[] = []
    walkTsFiles(dir, (full, text) => {
      if (full.includes(`${resolve('src/main/integrations/tradovate/__smoke__')}`)) return // test source, not production code
      for (const pattern of forbidden) if (pattern.test(text)) violations.push(`${full}: matches ${pattern}`)
    })
    assert(violations.length === 0, `forbidden persistence/trading import found: ${violations.join('; ')}`)
  })

  await check('Tradovate dev snapshot path stays under the gitignored .dev-data directory', () => {
    const gitignore = readFileSync(resolve('.gitignore'), 'utf8')
    assert(gitignore.includes('.dev-data/'), '.gitignore must ignore .dev-data/')
    const dir = devSnapshotDirectory(resolve('.'))
    assert(dir.includes('.dev-data') && dir.includes('tradovate'), 'snapshot directory is under .dev-data/tradovate')
  })

  // ------------------------------------------------------------------ raw staging: dedup / conflict / capacity
  await check('12. identical replay is a harmless duplicate (staged once)', () => {
    const staging = new TradovateRawStaging()
    equal(staging.stage(REPLAY_IDENTICAL[0] as (typeof REPLAY_IDENTICAL)[number]), 'accepted', 'first accepted')
    equal(staging.stage(REPLAY_IDENTICAL[1] as (typeof REPLAY_IDENTICAL)[number]), 'duplicate', 'second is a duplicate')
    assert(staging.size === 1, 'only one fill staged')
  })

  await check('13. conflicting duplicate source id is flagged, first-seen kept', () => {
    const staging = new TradovateRawStaging()
    equal(staging.stage(REPLAY_CONFLICTING[0] as (typeof REPLAY_CONFLICTING)[number]), 'accepted', 'first accepted')
    equal(staging.stage(REPLAY_CONFLICTING[1] as (typeof REPLAY_CONFLICTING)[number]), 'conflict', 'second is a conflict')
    assert(staging.conflicts === 1, 'conflict counted')
    const identity = rawFillIdentity(REPLAY_CONFLICTING[0] as (typeof REPLAY_CONFLICTING)[number])
    equal(staging.get(identity)?.fill.price, '20000', 'first-seen record was never overwritten')
  })

  await check('array position is never identity: capacity/limits are keyed by fill identity, not index', () => {
    const staging = new TradovateRawStaging(1)
    equal(staging.stage(SIMPLE_LONG[0] as (typeof SIMPLE_LONG)[number]), 'accepted', 'first accepted under capacity 1')
    equal(staging.stage(SIMPLE_LONG[1] as (typeof SIMPLE_LONG)[number]), 'capacity', 'second refused: capacity reached')
  })

  // ------------------------------------------------------------------ normalizer: direction, lifecycle, edge cases
  const normalize = (fills: readonly unknown[], accountId: string) => normalizeTradovateFills(fills as never, { accountId })

  await check('1/3. simple long: BUY in, SELL out -> one LONG completed candidate', () => {
    const result = normalize(SIMPLE_LONG, ACCOUNT_A)
    equal(result.completed.length, 1, 'one completed candidate')
    equal(result.completed[0]?.direction, 'LONG', 'direction is LONG')
    equal(result.completed[0]?.executions.length, 2, 'two executions')
  })

  await check('2/4. simple short: SELL in, BUY out -> one SHORT completed candidate', () => {
    const result = normalize(SIMPLE_SHORT, ACCOUNT_A)
    equal(result.completed.length, 1, 'one completed candidate')
    equal(result.completed[0]?.direction, 'SHORT', 'direction is SHORT')
  })

  await check('direction inversion regression: a closing SELL never makes a LONG read as SHORT', () => {
    const result = normalize(SIMPLE_LONG, ACCOUNT_A)
    assert(result.completed[0]?.direction === 'LONG', 'closing SELL must not flip direction to SHORT')
  })

  await check('direction inversion regression: a closing BUY never makes a SHORT read as LONG', () => {
    const result = normalize(SIMPLE_SHORT, ACCOUNT_A)
    assert(result.completed[0]?.direction === 'SHORT', 'closing BUY must not flip direction to LONG')
  })

  await check('5/9. multiple fills under one order id merge into one lifecycle (order != trade)', () => {
    const result = normalize(MULTI_FILL_ONE_ORDER, ACCOUNT_A)
    equal(result.completed.length, 1, 'one completed candidate despite 2 orders/3 fills')
    equal(result.completed[0]?.executions.length, 3, 'three executions')
    equal(result.completed[0]?.openedQuantity, '2', 'opened quantity sums scale-in fills')
  })

  await check('6/8. scale-in then two partial exits -> one completed candidate, four executions', () => {
    const result = normalize(SCALE_IN_PARTIAL_OUT, ACCOUNT_A)
    equal(result.completed.length, 1, 'one completed candidate')
    equal(result.completed[0]?.executions.length, 4, 'four executions (BUY,BUY,SELL,SELL)')
    equal(result.completed[0]?.direction, 'LONG', 'still LONG')
  })

  await check('7. partial exit alone leaves an OPEN lifecycle, never a completed Trade', () => {
    const result = normalize(PARTIAL_EXIT_STAYS_OPEN, ACCOUNT_A)
    equal(result.completed.length, 0, 'nothing completed')
    equal(result.open.length, 1, 'one open lifecycle')
    equal(result.open[0]?.remainingQuantity, '2', 'remaining quantity tracked')
  })

  await check('10. two accounts on the same contract stay fully isolated', () => {
    const forA = normalize(TWO_ACCOUNTS_SAME_CONTRACT.filter((f) => f.accountId === ACCOUNT_A), ACCOUNT_A)
    const forB = normalize(TWO_ACCOUNTS_SAME_CONTRACT.filter((f) => f.accountId === ACCOUNT_B), ACCOUNT_B)
    equal(forA.completed.length, 1, 'account A: one completed')
    equal(forA.completed[0]?.direction, 'LONG', 'account A is LONG')
    equal(forB.completed.length, 1, 'account B: one completed')
    equal(forB.completed[0]?.direction, 'SHORT', 'account B is SHORT — independent of account A')
    // Feeding all fills through account A's context must ignore B's fills outright.
    const mixed = normalize(TWO_ACCOUNTS_SAME_CONTRACT, ACCOUNT_A)
    equal(mixed.completed.length, 1, 'account-scoped normalize ignores the other account entirely')
  })

  await check('11. two instruments on one account reconstruct independently', () => {
    const result = normalize(TWO_INSTRUMENTS_ONE_ACCOUNT, ACCOUNT_A)
    equal(result.completed.length, 2, 'two completed candidates, one per contract')
    const byContract = new Map(result.completed.map((c) => [c.contractId, c]))
    equal(byContract.get(CONTRACT_MNQ)?.direction, 'LONG', 'MNQ lifecycle is LONG')
    equal(byContract.get(CONTRACT_ES)?.direction, 'SHORT', 'ES lifecycle is SHORT')
  })

  await check('12. identical replay dedup at the normalizer level', () => {
    const result = normalize(REPLAY_IDENTICAL, ACCOUNT_A)
    equal(result.stats.duplicateFillsDropped, 1, 'one duplicate dropped')
    equal(result.stats.rawFillsReceived, 2, 'both inputs counted as received')
  })

  await check('13. conflicting duplicate source id withholds the lifecycle at the normalizer level', () => {
    const result = normalize(REPLAY_CONFLICTING, ACCOUNT_A)
    equal(result.completed.length, 0, 'nothing completed')
    equal(result.rejected.length, 1, 'one rejected fill')
    equal(result.rejected[0]?.reason, 'FILL_CONFLICT', 'conflict reason recorded')
  })

  await check('14. out-of-order facts still resolve correctly (canonical sort by time, not arrival)', () => {
    const result = normalize(OUT_OF_ORDER, ACCOUNT_A)
    equal(result.completed.length, 1, 'one completed candidate despite exit-first delivery')
    equal(result.completed[0]?.direction, 'LONG', 'opening BUY still determines direction')
    equal(result.unresolved.length, 0, 'canonical ordering resolves this cleanly; nothing is left unresolved')
  })

  await check('15. same-timestamp fills order deterministically by numeric fill id', () => {
    const result = normalize(SAME_TIMESTAMP, ACCOUNT_A)
    equal(result.completed.length, 1, 'resolves to one completed candidate regardless of arrival order')
    equal(result.completed[0]?.executions[0]?.role, 'ENTRY', 'lower fill id (the true entry) sorts first')
  })

  await check('16. open lifecycle stays open, never fabricated as completed', () => {
    const result = normalize(OPEN_LIFECYCLE, ACCOUNT_A)
    equal(result.open.length, 1, 'one open lifecycle')
    equal(result.completed.length, 0, 'nothing completed')
  })

  await check('17. closed lifecycle status is COMPLETED with a closedAtIso', () => {
    const result = normalize(SIMPLE_LONG, ACCOUNT_A)
    assert(result.completed[0]?.status === 'COMPLETED', 'status is COMPLETED')
    assert(typeof result.completed[0]?.closedAtIso === 'string', 'closedAtIso is set')
  })

  await check('18. LONG -> SHORT reversal fill stays conservative (unresolved, not segmented)', () => {
    const result = normalize(REVERSAL_LONG_TO_SHORT, ACCOUNT_A)
    equal(result.completed.length, 0, 'nothing completed')
    equal(result.open.length, 0, 'nothing left open either')
    equal(result.unresolved.length, 1, 'one unresolved lifecycle')
    equal(result.unresolved[0]?.reasons, ['REVERSAL_NOT_PRODUCTION_PROVEN'], 'reversal reason recorded, nothing guessed')
    equal(result.unresolved[0]?.reversals[0]?.candidateReversalQuantity, '1', 'observation preserved without being applied')
  })

  await check('19. SHORT -> LONG reversal fill stays conservative (unresolved, not segmented)', () => {
    const result = normalize(REVERSAL_SHORT_TO_LONG, ACCOUNT_A)
    equal(result.unresolved.length, 1, 'one unresolved lifecycle')
    equal(result.unresolved[0]?.reasons, ['REVERSAL_NOT_PRODUCTION_PROVEN'], 'reversal reason recorded')
  })

  // ------------------------------------------------------------------ lifecycle identity correction
  await check('grouping key != durable identity: two independent round trips on the same account+contract stay separate', () => {
    const result = normalize(TWO_ROUND_TRIPS_SAME_ACCOUNT_AND_CONTRACT, ACCOUNT_A)
    equal(result.completed.length, 2, 'two independent completed candidates, never merged')
    equal(result.completed[0]?.direction, 'LONG', 'first round trip is LONG')
    equal(result.completed[1]?.direction, 'SHORT', 'second, later round trip is an independent SHORT — not merged with the first')
    assert(result.completed[0]?.sourceLifecycleKey !== result.completed[1]?.sourceLifecycleKey, 'each round trip gets its own lifecycle identity')
    assert(result.completed[0]?.openingFillId !== result.completed[1]?.openingFillId, 'identity is anchored to each segment\'s own opening fill, not a position-in-sequence counter')
  })

  await check('a later reversal never erases an earlier, already-completed round trip on the same account+contract', () => {
    const result = normalize(COMPLETED_ROUND_TRIP_THEN_REVERSAL, ACCOUNT_A)
    equal(result.completed.length, 1, 'the first, already-flat round trip stays completed')
    equal(result.completed[0]?.direction, 'LONG', 'first round trip direction preserved')
    equal(result.unresolved.length, 1, 'the second round trip, which reverses, is withheld on its own')
    equal(result.unresolved[0]?.reasons, ['REVERSAL_NOT_PRODUCTION_PROVEN'], 'only the reversing segment is flagged')
  })

  // ------------------------------------------------------------------ reconciliation-only facts (Position / FillPair / FillFee)
  await check('Position.id is preserved as provenance only, never treated as Solid Skill Trade identity', () => {
    const p = position({ accountId: ACCOUNT_A, contractId: CONTRACT_MNQ, id: 'pos-1', netPos: '1', bought: '1', boughtValue: '20000' })
    equal(p.id, 'pos-1', 'id preserved verbatim')
    equal(p.accountId, ACCOUNT_A, 'accountId preserved')
    equal(p.netPos, '1', 'netPos preserved as reported')
    const identity = rawPositionIdentity(p)
    assert(identity.includes('Position'), 'identity is explicitly tagged as a Position fact')
    // Nothing in this module's exported types/functions offers a way to turn a
    // Position row into a `sourceLifecycleKey` — the normalizer never imports
    // Position at all, which is the structural proof it cannot be used as Trade identity.
  })

  await check('FillPair preserves buy/sell fill ids and qty without becoming canonical Trade identity', () => {
    const pair = fillPair({ buyFillId: '9001', sellFillId: '9002', qty: '1', buyPrice: '20000', sellPrice: '20010', active: false })
    equal(pair.buyFillId, '9001', 'buyFillId preserved')
    equal(pair.sellFillId, '9002', 'sellFillId preserved')
    equal(pair.active, false, 'active flag preserved as reported')
    const identity = rawFillPairIdentity(pair)
    assert(identity.includes('FillPair'), 'identity is explicitly tagged as a FillPair fact, distinct from a fill or lifecycle identity')
  })

  await check('FillFee preserves each fee/commission category independently, null distinct from zero', () => {
    const fee = fillFee({ id: 'fee-1', attributedFillId: '9001', commission: '2.50', commissionCurrencyId: 'USD', exchangeFee: '0', clearingFee: null })
    equal(fee.commission, '2.50', 'commission preserved exactly')
    equal(fee.exchangeFee, '0', 'a reported zero is kept as zero')
    equal(fee.clearingFee, null, 'an unreported category stays null, never invented as zero')
    const identity = rawFillFeeIdentity(fee)
    assert(identity.includes('FillFee'), 'identity is explicitly tagged as a FillFee fact')
  })

  await check('21. source contract identity preserved verbatim, never collapsed', () => {
    const result = normalize(CONTRACT_IDENTITY_PRESERVED, ACCOUNT_A)
    equal(result.completed[0]?.contractName, 'MNQZ6', 'dated contract name preserved exactly')
    equal(result.completed[0]?.contractId, CONTRACT_MNQ, 'source contract id preserved')
  })

  await check('decimal grammar rejects exponents/numbers/oversized fractions, matching the persistence codec', () => {
    equal(canonicalizeDecimal('1e5'), null, 'exponent rejected')
    equal(canonicalizeDecimal('NaN'), null, 'NaN rejected')
    equal(canonicalizeDecimal('1.123456789'), null, 'more than 8 fractional digits rejected')
    equal(canonicalizeDecimal('+2.50'), '2.5', 'canonicalized, trailing zero trimmed')
    equal(canonicalizeDecimal('-0'), '0', 'negative zero canonicalized')
  })

  await check('unknown fill action is rejected, never guessed as Buy or Sell', () => {
    const malformed = { ...(SIMPLE_LONG[0] as (typeof SIMPLE_LONG)[number]), action: 'Unknown' as unknown as 'Buy' }
    const result = normalize([malformed], ACCOUNT_A)
    equal(result.completed.length, 0, 'nothing completed')
    equal(result.rejected[0]?.reason, 'UNKNOWN_ACTION', 'unknown action rejected')
  })

  process.stdout.write(lines.join('\n') + '\n')
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
