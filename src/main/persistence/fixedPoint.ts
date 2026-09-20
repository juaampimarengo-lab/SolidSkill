/**
 * Fixed-point decimal codec for persisted financial values.
 *
 * Every price, quantity, P&L, commission/fee, swap, and R value is stored as
 * an exact integer count of 10^-8 units (scale 8) in a SQLite INTEGER
 * (signed 64-bit). Outside the persistence layer these values travel as
 * canonical decimal STRINGS (e.g. "-1234.5", "0.01"), never JS numbers, so
 * no binary floating-point rounding can enter the stored history.
 *
 * Parsing REJECTS input with more than 8 fractional digits instead of
 * rounding it silently: a value the schema cannot represent exactly is an
 * error at the boundary, not a quiet change to historical data.
 */

export const DECIMAL_SCALE = 8
const SCALE_FACTOR = 10n ** BigInt(DECIMAL_SCALE)
const INT64_MAX = 9223372036854775807n
const INT64_MIN = -9223372036854775808n

/** Canonical decimal string, e.g. "12", "-0.5", "1234.25". */
export type Decimal = string

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/

export function decimalToScaled(value: Decimal): bigint {
  const match = DECIMAL_PATTERN.exec(value.trim())
  if (match === null) {
    throw new RangeError(`Invalid decimal value: ${JSON.stringify(value)}`)
  }
  const [, sign, whole, fraction = ''] = match
  const trimmedFraction = fraction.replace(/0+$/, '')
  if (trimmedFraction.length > DECIMAL_SCALE) {
    throw new RangeError(
      `Decimal ${JSON.stringify(value)} has more than ${DECIMAL_SCALE} fractional digits`
    )
  }
  const scaled =
    BigInt(whole) * SCALE_FACTOR + BigInt(trimmedFraction.padEnd(DECIMAL_SCALE, '0'))
  const signed = sign === '-' ? -scaled : scaled
  if (signed > INT64_MAX || signed < INT64_MIN) {
    throw new RangeError(`Decimal ${JSON.stringify(value)} exceeds the storable range`)
  }
  return signed
}

export function scaledToDecimal(scaled: bigint): Decimal {
  const negative = scaled < 0n
  const magnitude = negative ? -scaled : scaled
  const whole = magnitude / SCALE_FACTOR
  const fraction = (magnitude % SCALE_FACTOR)
    .toString()
    .padStart(DECIMAL_SCALE, '0')
    .replace(/0+$/, '')
  const body = fraction === '' ? whole.toString() : `${whole}.${fraction}`
  return negative ? `-${body}` : body
}

export function decimalToScaledOrNull(value: Decimal | null | undefined): bigint | null {
  return value === null || value === undefined ? null : decimalToScaled(value)
}

export function scaledToDecimalOrNull(value: bigint | null): Decimal | null {
  return value === null ? null : scaledToDecimal(value)
}
