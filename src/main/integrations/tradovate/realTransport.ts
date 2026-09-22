/**
 * The FIRST real (HTTP) `TradovateTransport` implementation (013B). Speaks
 * Tradovate's REST API over `fetch`. READ-ONLY BY CONSTRUCTION: it implements
 * exactly the `TradovateTransport` interface (transport.ts) and nothing more
 * — there is no method here, public or private, that calls a write endpoint.
 * `npm run smoke:tradovate`'s static source scan covers this file too.
 *
 * Base URLs, auth fields, and token lifetime are documented in
 * docs/TRADOVATE_RAW_CONTRACT.md §3, §13 (PROVEN BY OFFICIAL DOCS). Real
 * response shapes beyond the documented schema, retention depth, and
 * Apex-specific scope are UNPROVEN UNTIL REAL ACCOUNT ACCESS — see
 * docs/TRADOVATE_REAL_QA.md.
 *
 * SECRETS: `authenticate()` sends `password`/`sec` in the request body (as
 * Tradovate's own documented endpoint requires) but never logs the request
 * body, the response body, or the resulting access token. Every thrown error
 * message is checked to exclude the raw credentials/token — see
 * `redactError`.
 */
import type {
  RawTradovateAccount,
  RawTradovateContract,
  RawTradovateFill,
  RawTradovateFillFee,
  RawTradovateFillPair,
  RawTradovateOrder,
  RawTradovatePosition
} from './protocol'
import { canonicalizeDecimal } from './protocol'
import type {
  HistoricalFillRange,
  TradovateCredentials,
  TradovateSession,
  TradovateTransport
} from './transport'
import type { TradovateEnvironment } from './credentials'

export function tradovateRestBaseUrl(environment: TradovateEnvironment): string {
  return environment === 'live' ? 'https://live.tradovateapi.com/v1' : 'https://demo.tradovateapi.com/v1'
}

// ---------------------------------------------------------------------------
// Explicit, typed failure modes — nothing here silently swallows a real error.
// ---------------------------------------------------------------------------

export class TradovateAuthError extends Error {
  constructor(public readonly status: number) {
    super(`Tradovate authentication/session rejected (HTTP ${status}).`)
    this.name = 'TradovateAuthError'
  }
}
export class TradovateRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number | null) {
    super(`Tradovate rate limit reached${retryAfterSeconds !== null ? ` (retry after ${retryAfterSeconds}s)` : ''}.`)
    this.name = 'TradovateRateLimitError'
  }
}
export class TradovateMalformedPayloadError extends Error {
  constructor(context: string) {
    super(`Tradovate returned a payload that could not be safely interpreted: ${context}`)
    this.name = 'TradovateMalformedPayloadError'
  }
}
export class TradovateHttpError extends Error {
  constructor(public readonly status: number, context: string) {
    super(`Tradovate HTTP ${status}: ${context}`)
    this.name = 'TradovateHttpError'
  }
}

/** Removes anything that could be a credential/token before an error ever reaches a log line. */
function redactError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error('Tradovate transport error (non-Error thrown value redacted).')
}

export interface HttpTradovateTransportOptions {
  readonly environment: TradovateEnvironment
  /** Injectable for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch
}

/**
 * Converts a Tradovate JSON numeric field to canonical decimal text.
 *
 * CAVEAT (docs/TRADOVATE_RAW_CONTRACT.md §15, item 7): Tradovate's documented
 * field types are `double`/`integer`/`long`. By the time `JSON.parse` hands a
 * value to this function it has already gone through an IEEE-754 double
 * round-trip; for any value whose exact decimal text needs more precision
 * than a double carries, this conversion cannot recover it. This is flagged
 * as UNPROVEN/best-effort, not silently assumed safe, pending a real payload
 * to test against. A future revision may need to parse the raw response text
 * instead of `response.json()` to preserve full precision.
 */
function numberToDecimalText(value: unknown, field: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TradovateMalformedPayloadError(`field "${field}" is not a finite number`)
  const text = value.toString()
  if (text.includes('e') || text.includes('E')) throw new TradovateMalformedPayloadError(`field "${field}" used exponential notation (${text}); cannot be converted exactly`)
  const canonical = canonicalizeDecimal(text)
  if (canonical === null) throw new TradovateMalformedPayloadError(`field "${field}" value ${text} is not representable as a scale<=8 decimal`)
  return canonical
}

function requireString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new TradovateMalformedPayloadError(`missing/invalid required field "${field}"`)
}
function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}
function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}
function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value
  throw new TradovateMalformedPayloadError(`missing/invalid required field "${field}"`)
}
function tradeDateText(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null) throw new TradovateMalformedPayloadError(`missing/invalid required field "${field}"`)
  const rec = value as Record<string, unknown>
  const y = rec['year']
  const m = rec['month']
  const d = rec['day']
  if (typeof y !== 'number' || typeof m !== 'number' || typeof d !== 'number') {
    throw new TradovateMalformedPayloadError(`field "${field}" is not a {year,month,day} object`)
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export class HttpTradovateTransport implements TradovateTransport {
  private readonly environment: TradovateEnvironment
  private readonly fetchImpl: typeof fetch
  private readonly contractNameCache = new Map<string, string>()

  constructor(options: HttpTradovateTransportOptions) {
    this.environment = options.environment
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private get baseUrl(): string {
    return tradovateRestBaseUrl(this.environment)
  }

  /** Every request goes through here: uniform 401/403/429 handling, uniform malformed-JSON handling, never logs headers/body. */
  private async request(path: string, init: { method?: string; body?: unknown; accessToken?: string } = {}): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(init.accessToken !== undefined ? { Authorization: `Bearer ${init.accessToken}` } : {})
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      })
    } catch (error) {
      throw redactError(error)
    }

    if (response.status === 401 || response.status === 403) {
      throw new TradovateAuthError(response.status)
    }
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After')
      const retryAfterSeconds = retryAfterHeader !== null && !Number.isNaN(Number(retryAfterHeader)) ? Number(retryAfterHeader) : null
      throw new TradovateRateLimitError(retryAfterSeconds)
    }
    if (!response.ok) {
      throw new TradovateHttpError(response.status, path)
    }

    let text: string
    try {
      text = await response.text()
    } catch (error) {
      throw redactError(error)
    }
    if (text.length === 0) return null
    try {
      return JSON.parse(text)
    } catch {
      throw new TradovateMalformedPayloadError(`response for ${path} was not valid JSON`)
    }
  }

  private requireArray(payload: unknown, context: string): readonly unknown[] {
    if (!Array.isArray(payload)) throw new TradovateMalformedPayloadError(`expected an array from ${context}`)
    return payload
  }

  async authenticate(credentials: TradovateCredentials): Promise<TradovateSession> {
    const payload = await this.request('/auth/accesstokenrequest', {
      method: 'POST',
      body: {
        name: credentials.name,
        password: credentials.password,
        appId: credentials.appId,
        appVersion: credentials.appVersion,
        cid: credentials.cid,
        sec: credentials.sec
      }
    })
    if (typeof payload !== 'object' || payload === null) throw new TradovateMalformedPayloadError('accesstokenrequest response was not an object')
    const rec = payload as Record<string, unknown>
    if (typeof rec['errorText'] === 'string' && rec['errorText'].length > 0) {
      throw new TradovateAuthError(401)
    }
    const accessToken = requireString(rec['accessToken'], 'accessToken')
    const expirationTime = requireString(rec['expirationTime'], 'expirationTime')
    const userId = requireString(rec['userId'], 'userId')
    const expiresAtMsc = Date.parse(expirationTime)
    if (Number.isNaN(expiresAtMsc)) throw new TradovateMalformedPayloadError('expirationTime was not a parseable date')
    return { accessToken, mdAccessToken: optionalString(rec['mdAccessToken']), expiresAtMsc, userId }
  }

  async renewSession(session: TradovateSession): Promise<TradovateSession> {
    const payload = await this.request('/auth/renewaccesstoken', { accessToken: session.accessToken })
    if (typeof payload !== 'object' || payload === null) throw new TradovateMalformedPayloadError('renewaccesstoken response was not an object')
    const rec = payload as Record<string, unknown>
    const accessToken = requireString(rec['accessToken'], 'accessToken')
    const expirationTime = requireString(rec['expirationTime'], 'expirationTime')
    const expiresAtMsc = Date.parse(expirationTime)
    if (Number.isNaN(expiresAtMsc)) throw new TradovateMalformedPayloadError('expirationTime was not a parseable date')
    return { ...session, accessToken, expiresAtMsc }
  }

  async listAccounts(session: TradovateSession): Promise<readonly RawTradovateAccount[]> {
    const payload = await this.request('/account/list', { accessToken: session.accessToken })
    return this.requireArray(payload, 'account/list').map((raw) => {
      const rec = raw as Record<string, unknown>
      return {
        id: requireString(rec['id'], 'id'),
        name: requireString(rec['name'], 'name'),
        userId: requireString(rec['userId'], 'userId'),
        accountType: optionalString(rec['accountType']),
        active: optionalBoolean(rec['active']),
        clearingHouseId: optionalString(rec['clearingHouseId']),
        legalStatus: optionalString(rec['legalStatus'])
      }
    })
  }

  async listContracts(session: TradovateSession, contractIds: readonly string[]): Promise<readonly RawTradovateContract[]> {
    const results: RawTradovateContract[] = []
    for (const id of contractIds) {
      const cached = this.contractNameCache.get(id)
      if (cached !== undefined) continue
      const payload = await this.request(`/contract/item?id=${encodeURIComponent(id)}`, { accessToken: session.accessToken })
      if (typeof payload !== 'object' || payload === null) continue
      const rec = payload as Record<string, unknown>
      const contract: RawTradovateContract = {
        id: requireString(rec['id'], 'id'),
        name: requireString(rec['name'], 'name'),
        productId: optionalString(rec['productId']),
        expirationDate: optionalString(rec['expirationDate'])
      }
      this.contractNameCache.set(id, contract.name)
      results.push(contract)
    }
    return results
  }

  private async resolveContractName(session: TradovateSession, contractId: string): Promise<string> {
    const cached = this.contractNameCache.get(contractId)
    if (cached !== undefined) return cached
    const [contract] = await this.listContracts(session, [contractId])
    const name = contract?.name ?? contractId
    this.contractNameCache.set(contractId, name)
    return name
  }

  /**
   * Fill has no native accountId (docs/TRADOVATE_RAW_CONTRACT.md §5): this
   * joins fill.orderId -> Order.accountId, per the documented Order schema.
   */
  async listHistoricalFills(session: TradovateSession, accountId: string, range: HistoricalFillRange): Promise<readonly RawTradovateFill[]> {
    const orders = await this.listOrders(session, accountId)
    const accountOrderIds = new Set(orders.map((o) => o.id))

    const payload = await this.request('/fill/list', { accessToken: session.accessToken })
    const raw = this.requireArray(payload, 'fill/list')
    const results: RawTradovateFill[] = []
    for (const entry of raw) {
      const rec = entry as Record<string, unknown>
      const orderId = requireString(rec['orderId'], 'orderId')
      if (!accountOrderIds.has(orderId)) continue // not this account's fill

      const timestamp = requireString(rec['timestamp'], 'timestamp')
      if (timestamp < range.fromTimestamp || timestamp > range.toTimestamp) continue

      const contractId = requireString(rec['contractId'], 'contractId')
      const action = rec['action']
      if (action !== 'Buy' && action !== 'Sell') throw new TradovateMalformedPayloadError(`fill action was not "Buy"/"Sell": ${JSON.stringify(action)}`)

      results.push({
        source: 'Tradovate',
        contractVersion: 1,
        accountId,
        contractId,
        contractName: await this.resolveContractName(session, contractId),
        fillId: requireString(rec['id'], 'id'),
        orderId,
        action,
        quantity: numberToDecimalText(rec['qty'], 'qty'),
        price: numberToDecimalText(rec['price'], 'price'),
        timestamp,
        tradeDate: tradeDateText(rec['tradeDate'], 'tradeDate'),
        active: requireBoolean(rec['active'], 'active'),
        finallyPaired: typeof rec['finallyPaired'] === 'number' ? (rec['finallyPaired'] as number) : 0,
        origin: 'history'
      })
    }
    return results
  }

  async listOrders(session: TradovateSession, accountId: string): Promise<readonly RawTradovateOrder[]> {
    const payload = await this.request('/order/list', { accessToken: session.accessToken })
    const raw = this.requireArray(payload, 'order/list')
    const results: RawTradovateOrder[] = []
    for (const entry of raw) {
      const rec = entry as Record<string, unknown>
      const orderAccountId = requireString(rec['accountId'], 'accountId')
      if (orderAccountId !== accountId) continue
      const action = rec['action']
      if (action !== 'Buy' && action !== 'Sell') continue
      results.push({
        id: requireString(rec['id'], 'id'),
        accountId: orderAccountId,
        contractId: optionalString(rec['contractId']),
        action,
        ordStatus: requireString(rec['ordStatus'], 'ordStatus'),
        timestamp: requireString(rec['timestamp'], 'timestamp')
      })
    }
    return results
  }

  async listPositions(session: TradovateSession, accountId: string): Promise<readonly RawTradovatePosition[]> {
    const payload = await this.request('/position/list', { accessToken: session.accessToken })
    const raw = this.requireArray(payload, 'position/list')
    const results: RawTradovatePosition[] = []
    for (const entry of raw) {
      const rec = entry as Record<string, unknown>
      const positionAccountId = requireString(rec['accountId'], 'accountId')
      if (positionAccountId !== accountId) continue
      results.push({
        id: optionalString(rec['id']),
        accountId: positionAccountId,
        contractId: requireString(rec['contractId'], 'contractId'),
        netPos: String(rec['netPos'] ?? '0'),
        bought: String(rec['bought'] ?? '0'),
        boughtValue: numberToDecimalText(rec['boughtValue'], 'boughtValue'),
        sold: String(rec['sold'] ?? '0'),
        soldValue: numberToDecimalText(rec['soldValue'], 'soldValue'),
        prevPos: String(rec['prevPos'] ?? '0'),
        netPrice: rec['netPrice'] === undefined || rec['netPrice'] === null ? null : numberToDecimalText(rec['netPrice'], 'netPrice'),
        prevPrice: rec['prevPrice'] === undefined || rec['prevPrice'] === null ? null : numberToDecimalText(rec['prevPrice'], 'prevPrice'),
        tradeDate: tradeDateText(rec['tradeDate'], 'tradeDate'),
        timestamp: requireString(rec['timestamp'], 'timestamp')
      })
    }
    return results
  }

  /**
   * FillPair has no accountId field (docs/TRADOVATE_RAW_CONTRACT.md §7): this
   * attributes to `accountId` by cross-referencing this account's own
   * Position ids (adapter-side join, not a native FillPair field — UNPROVEN
   * UNTIL REAL ACCOUNT ACCESS, same caveat as the FillFee linkage).
   */
  async listFillPairs(session: TradovateSession, accountId: string): Promise<readonly RawTradovateFillPair[]> {
    const positions = await this.listPositions(session, accountId)
    const positionIds = new Set(positions.map((p) => p.id).filter((id): id is string => id !== null))

    const payload = await this.request('/fillPair/list', { accessToken: session.accessToken })
    const raw = this.requireArray(payload, 'fillPair/list')
    const results: RawTradovateFillPair[] = []
    for (const entry of raw) {
      const rec = entry as Record<string, unknown>
      const positionId = requireString(rec['positionId'], 'positionId')
      if (!positionIds.has(positionId)) continue
      results.push({
        id: optionalString(rec['id']),
        positionId,
        buyFillId: requireString(rec['buyFillId'], 'buyFillId'),
        sellFillId: requireString(rec['sellFillId'], 'sellFillId'),
        qty: String(rec['qty'] ?? '0'),
        buyPrice: numberToDecimalText(rec['buyPrice'], 'buyPrice'),
        sellPrice: numberToDecimalText(rec['sellPrice'], 'sellPrice'),
        active: requireBoolean(rec['active'], 'active')
      })
    }
    return results
  }

  /**
   * FillFee has no fillId field (docs/TRADOVATE_RAW_CONTRACT.md §9a). Follows
   * the documented generic "dependents" convention
   * (`fillFee/deps?masterid=<fillId>`) per fill, since no batch-by-fillIds
   * endpoint is documented. UNPROVEN UNTIL REAL ACCOUNT ACCESS: a failed or
   * empty response for one fillId is treated as "no fee rows found for that
   * fill", never a fatal error for the whole call.
   */
  async listFillFees(session: TradovateSession, fillIds: readonly string[]): Promise<readonly RawTradovateFillFee[]> {
    const results: RawTradovateFillFee[] = []
    for (const fillId of fillIds) {
      let payload: unknown
      try {
        payload = await this.request(`/fillFee/deps?masterid=${encodeURIComponent(fillId)}`, { accessToken: session.accessToken })
      } catch (error) {
        if (error instanceof TradovateAuthError || error instanceof TradovateRateLimitError) throw error
        continue // documented lookup convention is unconfirmed; a failure here is evidence, not a fatal error
      }
      if (!Array.isArray(payload)) continue
      for (const entry of payload) {
        const rec = entry as Record<string, unknown>
        const feeValue = (key: string): string | null => {
          const v = rec[key]
          return v === undefined || v === null ? null : numberToDecimalText(v, key)
        }
        results.push({
          id: requireString(rec['id'], 'id'),
          attributedFillId: fillId,
          clearingFee: feeValue('clearingFee'),
          clearingCurrencyId: optionalString(rec['clearingCurrencyId']),
          exchangeFee: feeValue('exchangeFee'),
          exchangeCurrencyId: optionalString(rec['exchangeCurrencyId']),
          nfaFee: feeValue('nfaFee'),
          nfaCurrencyId: optionalString(rec['nfaCurrencyId']),
          brokerageFee: feeValue('brokerageFee'),
          brokerageCurrencyId: optionalString(rec['brokerageCurrencyId']),
          ipFee: feeValue('ipFee'),
          ipCurrencyId: optionalString(rec['ipCurrencyId']),
          commission: feeValue('commission'),
          commissionCurrencyId: optionalString(rec['commissionCurrencyId']),
          orderRoutingFee: feeValue('orderRoutingFee'),
          orderRoutingCurrencyId: optionalString(rec['orderRoutingCurrencyId'])
        })
      }
    }
    return results
  }

  /**
   * Live subscription is deliberately NOT implemented in this checkpoint: the
   * documented `user/syncrequest` WebSocket frame shape is UNPROVEN UNTIL
   * REAL ACCOUNT ACCESS (docs/TRADOVATE_RAW_CONTRACT.md §14), and the brief
   * scopes this checkpoint to "optional websocket session if needed" — it is
   * not needed to prove auth/account/history/reconciliation evidence.
   * Returns a no-op unsubscribe so the interface remains fully implemented;
   * never silently pretends to have subscribed.
   */
  subscribeToFills(_session: TradovateSession, _accountId: string, _onFill: (fill: RawTradovateFill) => void): () => void {
    throw new Error('HttpTradovateTransport.subscribeToFills is not implemented in this checkpoint (013B) — see docs/TRADOVATE_REAL_QA.md.')
  }

  async disconnect(_session: TradovateSession): Promise<void> {
    // Tradovate's documented API has no session-teardown endpoint; nothing to call.
    // Clearing the in-memory session is the caller's (adapter's) responsibility.
  }
}
