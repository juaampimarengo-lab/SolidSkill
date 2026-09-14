export function formatUsd(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${sign}$${abs}`
}

// Whole-dollar variant for tight spaces (e.g. calendar day cells) where
// cent-level precision isn't legible at the available width.
export function formatUsdCompact(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return `${sign}$${abs}`
}

export function formatPrice(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatR(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(1)}R`
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}
