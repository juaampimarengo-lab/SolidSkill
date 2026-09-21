// Presentation formatting. Persisted values arrive as exact decimal strings;
// converting to a JS number here is display-only (never written back).
type Numeric = number | string

const num = (value: Numeric): number => (typeof value === 'string' ? Number(value) : value)

export function formatUsd(input: Numeric): string {
  const value = num(input)
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${sign}$${abs}`
}

// Whole-dollar variant for tight spaces (e.g. calendar day cells) where
// cent-level precision isn't legible at the available width.
export function formatUsdCompact(input: Numeric): string {
  const value = num(input)
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return `${sign}$${abs}`
}

// Compact "K" notation for header-level aggregates (monthly/weekly totals)
// where a full-precision figure would be too wide for an inline summary.
export function formatUsdCompactK(input: Numeric): string {
  const value = num(input)
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1000) {
    const scaled = abs / 1000
    const decimals = Number.isInteger(scaled) ? 0 : 2
    return `${sign}$${scaled.toFixed(decimals)}K`
  }
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function formatPrice(input: Numeric): string {
  return num(input).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatR(input: Numeric): string {
  const value = num(input)
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(1)}R`
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}
