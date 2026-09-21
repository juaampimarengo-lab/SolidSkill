// Exact decimal arithmetic for persisted financial values. The main process
// sends money/price/quantity/R as canonical decimal STRINGS; aggregation
// (day totals, running P&L, monthly stats) happens here on scaled BigInts so no
// binary-float rounding can enter a persisted fact. Converting to a JS number
// is a presentation step only (formatting, chart coordinates) — see toNumber.

export type Decimal = string

const SCALE = 8
const FACTOR = 10n ** BigInt(SCALE)
const PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/

export function toScaled(value: Decimal): bigint {
  const match = PATTERN.exec(value.trim())
  if (match === null) throw new RangeError(`Invalid decimal value: ${JSON.stringify(value)}`)
  const [, sign, whole, fraction = ''] = match
  const scaled = BigInt(whole as string) * FACTOR + BigInt(fraction.slice(0, SCALE).padEnd(SCALE, '0'))
  return sign === '-' ? -scaled : scaled
}

export function fromScaled(scaled: bigint): Decimal {
  const negative = scaled < 0n
  const magnitude = negative ? -scaled : scaled
  const fraction = (magnitude % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '')
  const body = fraction === '' ? (magnitude / FACTOR).toString() : `${magnitude / FACTOR}.${fraction}`
  return negative ? `-${body}` : body
}

/** Exact sum. null entries (not reported) are skipped, not counted as zero. */
export function sumDecimals(values: ReadonlyArray<Decimal | null>): Decimal {
  return fromScaled(values.reduce<bigint>((n, v) => (v === null ? n : n + toScaled(v)), 0n))
}

/** Exact sum, or null when every entry is null (nothing was reported). */
export function sumDecimalsOrNull(values: ReadonlyArray<Decimal | null>): Decimal | null {
  return values.every((v) => v === null) ? null : sumDecimals(values)
}

export function decimalSign(value: Decimal): -1 | 0 | 1 {
  const scaled = toScaled(value)
  return scaled > 0n ? 1 : scaled < 0n ? -1 : 0
}

export function absDecimal(value: Decimal): Decimal {
  const scaled = toScaled(value)
  return fromScaled(scaled < 0n ? -scaled : scaled)
}

export function negateDecimal(value: Decimal): Decimal {
  return fromScaled(-toScaled(value))
}

/** true when a < b. */
export function decimalLessThan(a: Decimal, b: Decimal): boolean {
  return toScaled(a) < toScaled(b)
}

/** PRESENTATION ONLY: never write the result back to persistence. */
export function toNumber(value: Decimal): number {
  return Number(value)
}
