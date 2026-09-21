/**
 * MT5 raw-deal wire contract (protocol v1) — parsing and validation.
 *
 * READ-ONLY: this contract carries account and execution FACTS from the MT5
 * Expert Advisor to Solid Skill. It has no message that can command the
 * terminal, and the receiver never writes back to the EA.
 *
 * Framing: newline-delimited JSON (one JSON object per line, UTF-8).
 * This module is pure (no sockets, no Electron) so it is testable alone.
 * See docs/MT5_RAW_DEAL_CONTRACT.md.
 */

export const MT5_SOURCE = 'MT5' as const
export const MT5_PROTOCOL_VERSION = 1 as const
/** Arbitrary unassigned high port; configurable on both sides. */
export const DEFAULT_MT5_BRIDGE_PORT = 47615
/** A deal frame is < 1 KiB in practice; anything near this is not an EA. */
export const DEFAULT_MAX_FRAME_BYTES = 16 * 1024

/** Canonical decimal text (see canonicalizeDecimal). */
export type Decimal = string

export type PositionAccounting = 'RETAIL_NETTING' | 'EXCHANGE' | 'RETAIL_HEDGING'

// ENUM_ACCOUNT_MARGIN_MODE
const MARGIN_MODE_LABELS: Readonly<Record<number, PositionAccounting>> = {
  0: 'RETAIL_NETTING',
  1: 'EXCHANGE',
  2: 'RETAIL_HEDGING'
}

// ENUM_DEAL_TYPE (diagnostic labels only; the integer is the source of truth)
const DEAL_TYPE_LABELS: Readonly<Record<number, string>> = {
  0: 'BUY',
  1: 'SELL',
  2: 'BALANCE',
  3: 'CREDIT',
  4: 'CHARGE',
  5: 'CORRECTION',
  6: 'BONUS',
  7: 'COMMISSION',
  8: 'COMMISSION_DAILY',
  9: 'COMMISSION_MONTHLY',
  10: 'COMMISSION_AGENT_DAILY',
  11: 'COMMISSION_AGENT_MONTHLY',
  12: 'INTEREST',
  13: 'BUY_CANCELED',
  14: 'SELL_CANCELED',
  15: 'DIVIDEND',
  16: 'DIVIDEND_FRANKED',
  17: 'TAX'
}

// ENUM_DEAL_ENTRY
const DEAL_ENTRY_LABELS: Readonly<Record<number, string>> = {
  0: 'IN',
  1: 'OUT',
  2: 'INOUT',
  3: 'OUT_BY'
}

/** Null when the MT5 build reports a value this table does not know. */
export function positionAccountingOf(marginMode: number): PositionAccounting | null {
  return MARGIN_MODE_LABELS[marginMode] ?? null
}
export function dealTypeLabel(dealType: number): string | null {
  return DEAL_TYPE_LABELS[dealType] ?? null
}
export function dealEntryLabel(dealEntry: number): string | null {
  return DEAL_ENTRY_LABELS[dealEntry] ?? null
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Mt5Origin = 'live' | 'history'

export interface Mt5AccountHello {
  /** ACCOUNT_LOGIN as an unsigned decimal string. A source id, not a Solid Skill key. */
  readonly login: string
  readonly server: string
  readonly company: string | null
  readonly currency: string
  /** Raw ENUM_ACCOUNT_MARGIN_MODE. */
  readonly marginMode: number
  /** Raw ENUM_ACCOUNT_TRADE_MODE (demo/contest/real), if reported. */
  readonly tradeMode: number | null
  /** Derived by the EA from marginMode; null when unknown. */
  readonly hedgeCapable: boolean | null
}

export interface Mt5HelloMessage {
  readonly type: 'hello'
  readonly eaVersion: string
  readonly account: Mt5AccountHello
  readonly terminalBuild: number | null
  readonly terminalName: string | null
  /**
   * Optional local pairing key (NOT a broker credential). Consumed by the
   * receiver for the handshake and never stored or logged.
   */
  readonly bridgeKey: string | null
}

/** One MT5 deal exactly as reported. No derived direction, no derived trade. */
export interface RawMt5Deal {
  readonly source: typeof MT5_SOURCE
  readonly protocolVersion: typeof MT5_PROTOCOL_VERSION
  readonly server: string
  readonly accountLogin: string
  readonly dealTicket: string
  readonly orderTicket: string
  readonly positionId: string
  readonly externalId: string | null
  readonly timeMsc: number
  readonly symbol: string | null
  /** Raw ENUM_DEAL_TYPE. */
  readonly dealType: number
  /** Raw ENUM_DEAL_ENTRY. */
  readonly dealEntry: number
  readonly volume: Decimal
  readonly price: Decimal
  readonly profit: Decimal | null
  readonly commission: Decimal | null
  readonly fee: Decimal | null
  readonly swap: Decimal | null
  readonly magic: string
  /** Raw ENUM_DEAL_REASON. */
  readonly reason: number
}

export interface Mt5DealMessage {
  readonly type: 'deal'
  readonly origin: Mt5Origin
  readonly syncId: string | null
  readonly deal: RawMt5Deal
}

export interface Mt5HistoryBeginMessage {
  readonly type: 'history_begin'
  readonly syncId: string
}

export interface Mt5HistoryEndMessage {
  readonly type: 'history_end'
  readonly syncId: string
  /** Deals MT5 reported for the selected window (HistoryDealsTotal). */
  readonly discovered: number
  /** Deals the EA successfully read and sent inside this sync. */
  readonly sent: number
  /** Deals the EA could not read. */
  readonly failed: number
}

export interface Mt5HeartbeatMessage {
  readonly type: 'heartbeat'
}

export const MT5_ERROR_CODES = ['DEAL_FETCH_FAILED', 'HISTORY_SELECT_FAILED', 'INTERNAL'] as const
export type Mt5ErrorCode = (typeof MT5_ERROR_CODES)[number]

export interface Mt5ErrorMessage {
  readonly type: 'error'
  readonly code: Mt5ErrorCode
  /** Set for DEAL_FETCH_FAILED so the gap is visible and reconcilable. */
  readonly dealTicket: string | null
  readonly detail: string | null
  /** Failing MQL5 call/property (e.g. "HistoryDealGetTicket", "DEAL_ORDER"). Diagnostic only. */
  readonly stage: string | null
  /** Index in the HistorySelect list, when the failure is index-related. */
  readonly index: number | null
  /** GetLastError() at the failure. */
  readonly lastError: number | null
}

export type Mt5Message =
  | Mt5HelloMessage
  | Mt5DealMessage
  | Mt5HistoryBeginMessage
  | Mt5HistoryEndMessage
  | Mt5HeartbeatMessage
  | Mt5ErrorMessage

export type ParseResult =
  | { readonly ok: true; readonly message: Mt5Message }
  | { readonly ok: false; readonly reason: string }

// ---------------------------------------------------------------------------
// Decimal handling
// ---------------------------------------------------------------------------

const DECIMAL_SCALE = 8
const DECIMAL_TEXT = /^[+-]?\d+(?:\.\d+)?$/
const INT64_MAX = 9223372036854775807n

/**
 * Validates decimal text at the boundary and returns its canonical form
 * (no '+', no leading zeros, no trailing fractional zeros, "-0" -> "0"), or
 * null when it is not exactly representable in Solid Skill's fixed point
 * (scale 8, signed 64-bit). Numbers, exponents, NaN, and thousands
 * separators are all rejected. Mirrors persistence/fixedPoint.ts; the smoke
 * suite asserts the two agree. Nothing is ever rounded.
 */
export function canonicalizeDecimal(text: string): Decimal | null {
  if (text.length > 40 || !DECIMAL_TEXT.test(text)) return null
  const negative = text.startsWith('-')
  const unsigned = text.replace(/^[+-]/, '')
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const trimmedFraction = fraction.replace(/0+$/, '')
  if (trimmedFraction.length > DECIMAL_SCALE) return null
  const wholeDigits = whole.replace(/^0+(?=\d)/, '')
  const scaled = BigInt(wholeDigits) * 10n ** BigInt(DECIMAL_SCALE) + BigInt(trimmedFraction.padEnd(DECIMAL_SCALE, '0'))
  if (scaled > INT64_MAX) return null
  if (scaled === 0n) return '0'
  const body = trimmedFraction === '' ? wholeDigits : `${wholeDigits}.${trimmedFraction}`
  return negative ? `-${body}` : body
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

class FrameError extends Error {}

type Obj = Record<string, unknown>

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const UINT_STRING = /^(0|[1-9]\d{0,19})$/
const UINT64_MAX = 18446744073709551615n
const SYNC_ID = /^[A-Za-z0-9_-]{1,64}$/
const CURRENCY = /^[A-Za-z0-9]{1,8}$/
const MIN_TIME_MSC = 946684800000 // 2000-01-01
const MAX_TIME_MSC = 4102444800000 // 2100-01-01

function fail(reason: string): never {
  throw new FrameError(reason)
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function present(o: Obj, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(o, key)) fail(`missing field "${key}"`)
  return o[key]
}

function text(o: Obj, key: string, max: number): string {
  const v = present(o, key)
  if (typeof v !== 'string') fail(`"${key}" must be a string`)
  if (v.length < 1 || v.length > max) fail(`"${key}" length must be 1..${max}`)
  if (CONTROL_CHARS.test(v)) fail(`"${key}" contains control characters`)
  return v
}

/** Key must be present; null or "" means "not reported". */
function nullableText(o: Obj, key: string, max: number): string | null {
  const v = present(o, key)
  if (v === null || v === '') return null
  if (typeof v !== 'string') fail(`"${key}" must be a string or null`)
  if (v.length > max) fail(`"${key}" too long`)
  if (CONTROL_CHARS.test(v)) fail(`"${key}" contains control characters`)
  return v
}

function uint(o: Obj, key: string, allowZero: boolean): string {
  const v = present(o, key)
  if (typeof v !== 'string') fail(`"${key}" must be an unsigned integer string`)
  if (!UINT_STRING.test(v) || BigInt(v) > UINT64_MAX) fail(`"${key}" is not a valid unsigned 64-bit integer`)
  if (!allowZero && v === '0') fail(`"${key}" must be non-zero`)
  return v
}

function int(o: Obj, key: string, min: number, max: number): number {
  const v = present(o, key)
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    fail(`"${key}" must be an integer in ${min}..${max}`)
  }
  return v
}

function nullableInt(o: Obj, key: string, min: number, max: number): number | null {
  return present(o, key) === null ? null : int(o, key, min, max)
}

function decimal(o: Obj, key: string, nonNegative: boolean): Decimal {
  const v = present(o, key)
  if (typeof v !== 'string') fail(`"${key}" must be a decimal string`)
  const canonical = canonicalizeDecimal(v)
  if (canonical === null) fail(`"${key}" is not a valid decimal (max 8 fractional digits)`)
  if (nonNegative && canonical.startsWith('-')) fail(`"${key}" must not be negative`)
  return canonical
}

function nullableDecimal(o: Obj, key: string): Decimal | null {
  return present(o, key) === null ? null : decimal(o, key, false)
}

function nullableBoolean(o: Obj, key: string): boolean | null {
  const v = present(o, key)
  if (v === null) return null
  if (typeof v !== 'boolean') fail(`"${key}" must be a boolean or null`)
  return v
}

// ---------------------------------------------------------------------------
// Per-message parsers
// ---------------------------------------------------------------------------

function parseHello(o: Obj): Mt5HelloMessage {
  if (present(o, 'source') !== MT5_SOURCE) fail('source must be "MT5"')
  const account = present(o, 'account')
  if (!isObj(account)) fail('"account" must be an object')
  const terminal = present(o, 'terminal')
  if (!isObj(terminal)) fail('"terminal" must be an object')
  const key = Object.prototype.hasOwnProperty.call(o, 'bridgeKey') ? o['bridgeKey'] : null
  if (key !== null && (typeof key !== 'string' || key.length > 128)) fail('"bridgeKey" must be a short string')
  return {
    type: 'hello',
    eaVersion: text(o, 'eaVersion', 32),
    account: {
      login: uint(account, 'login', false),
      server: text(account, 'server', 128),
      company: nullableText(account, 'company', 128),
      currency: ((): string => {
        const c = text(account, 'currency', 8)
        if (!CURRENCY.test(c)) fail('"currency" is not a valid currency code')
        return c
      })(),
      marginMode: int(account, 'marginMode', 0, 255),
      tradeMode: nullableInt(account, 'tradeMode', 0, 255),
      hedgeCapable: nullableBoolean(account, 'hedgeCapable')
    },
    terminalBuild: nullableInt(terminal, 'build', 0, 1_000_000),
    terminalName: nullableText(terminal, 'name', 64),
    bridgeKey: key === '' ? null : (key as string | null)
  }
}

function parseDeal(o: Obj): Mt5DealMessage {
  if (present(o, 'source') !== MT5_SOURCE) fail('source must be "MT5"')
  const originValue = present(o, 'origin')
  if (originValue !== 'live' && originValue !== 'history') fail('"origin" must be "live" or "history"')
  const syncValue = present(o, 'syncId')
  let syncId: string | null = null
  if (originValue === 'history') {
    if (typeof syncValue !== 'string' || !SYNC_ID.test(syncValue)) fail('history deals need a valid "syncId"')
    syncId = syncValue
  } else if (syncValue !== null) {
    fail('live deals must have "syncId": null')
  }
  const timeMsc = int(o, 'timeMsc', MIN_TIME_MSC, MAX_TIME_MSC)
  return {
    type: 'deal',
    origin: originValue,
    syncId,
    deal: {
      source: MT5_SOURCE,
      protocolVersion: MT5_PROTOCOL_VERSION,
      server: text(o, 'server', 128),
      accountLogin: uint(o, 'accountLogin', false),
      dealTicket: uint(o, 'dealTicket', false),
      orderTicket: uint(o, 'orderTicket', true),
      positionId: uint(o, 'positionId', true),
      externalId: nullableText(o, 'externalId', 64),
      timeMsc,
      symbol: nullableText(o, 'symbol', 64),
      dealType: int(o, 'dealType', 0, 255),
      dealEntry: int(o, 'dealEntry', 0, 255),
      volume: decimal(o, 'volume', true),
      price: decimal(o, 'price', true),
      profit: nullableDecimal(o, 'profit'),
      commission: nullableDecimal(o, 'commission'),
      fee: nullableDecimal(o, 'fee'),
      swap: nullableDecimal(o, 'swap'),
      magic: uint(o, 'magic', true),
      reason: int(o, 'reason', 0, 255)
    }
  }
}

function parseSyncId(o: Obj): string {
  const v = present(o, 'syncId')
  if (typeof v !== 'string' || !SYNC_ID.test(v)) fail('"syncId" is invalid')
  return v
}

function parseError(o: Obj): Mt5ErrorMessage {
  const code = present(o, 'code')
  if (typeof code !== 'string' || !(MT5_ERROR_CODES as readonly string[]).includes(code)) fail('unknown error code')
  const hasTicket = Object.prototype.hasOwnProperty.call(o, 'dealTicket') && o['dealTicket'] !== null
  return {
    type: 'error',
    code: code as Mt5ErrorCode,
    dealTicket: hasTicket ? uint(o, 'dealTicket', false) : null,
    detail: Object.prototype.hasOwnProperty.call(o, 'detail') ? nullableText(o, 'detail', 200) : null,
    stage: Object.prototype.hasOwnProperty.call(o, 'stage') ? nullableText(o, 'stage', 64) : null,
    index: Object.prototype.hasOwnProperty.call(o, 'index') ? nullableInt(o, 'index', 0, 100_000_000) : null,
    lastError: Object.prototype.hasOwnProperty.call(o, 'lastError') ? nullableInt(o, 'lastError', 0, 1_000_000) : null
  }
}

/** Parses and validates one frame (one line, without its newline). Never throws. */
export function parseFrame(line: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { ok: false, reason: 'invalid JSON' }
  }
  if (!isObj(raw)) return { ok: false, reason: 'frame is not a JSON object' }
  try {
    if (raw['v'] !== MT5_PROTOCOL_VERSION) fail(`unsupported protocol version`)
    const type = raw['type']
    switch (type) {
      case 'hello':
        return { ok: true, message: parseHello(raw) }
      case 'deal':
        return { ok: true, message: parseDeal(raw) }
      case 'history_begin':
        return { ok: true, message: { type, syncId: parseSyncId(raw) } }
      case 'history_end': {
        const discovered = int(raw, 'discovered', 0, 10_000_000)
        const sent = int(raw, 'sent', 0, 10_000_000)
        const failed = int(raw, 'failed', 0, 10_000_000)
        if (sent > discovered || failed > discovered) fail('history_end counts are inconsistent')
        return { ok: true, message: { type, syncId: parseSyncId(raw), discovered, sent, failed } }
      }
      case 'heartbeat':
        return { ok: true, message: { type } }
      case 'error':
        return { ok: true, message: parseError(raw) }
      default:
        return { ok: false, reason: 'unknown message type' }
    }
  } catch (error) {
    if (error instanceof FrameError) return { ok: false, reason: error.message }
    throw error
  }
}
