/**
 * Privacy-safe structural QA report for a real Tradovate connectivity
 * capture (013B). Counts and shapes only — no full account ids, usernames,
 * tokens, order ids, fill ids, or raw private payload values. Mirrors
 * src/main/integrations/mt5/normalizer/structuralReport.ts, independently
 * implemented for Tradovate.
 */
import type { RawTradovateFill, RawTradovateFillFee, RawTradovateFillPair, RawTradovatePosition } from './protocol'
import type { TradovateNormalizationResult } from './normalizer'

export interface TradovateStructuralReport {
  readonly account: string
  readonly accountsFound: number
  readonly fillsFound: number
  readonly positionsFound: number
  readonly fillPairsFound: number
  readonly fillFeesFound: number
  readonly fillActions: Readonly<Record<'Buy' | 'Sell', number>>
  readonly uniqueContracts: number
  readonly dateRange: { readonly from: string | null; readonly to: string | null }
  readonly quantityDistribution: { readonly min: string | null; readonly max: string | null; readonly distinctValues: number }
  readonly completedCandidates: number
  readonly openCandidates: number
  readonly unresolvedCandidates: number
  readonly ambiguousReversalCases: number
  readonly rejectedFills: number
}

/** "***" + last 3 characters: distinguishes accounts in a log without identifying one. */
export function maskTradovateAccountId(accountId: string): string {
  return `***${accountId.slice(-3)}`
}

export function buildTradovateStructuralReport(
  accountId: string,
  accountsFound: number,
  fills: readonly RawTradovateFill[],
  positions: readonly RawTradovatePosition[],
  fillPairs: readonly RawTradovateFillPair[],
  fillFees: readonly RawTradovateFillFee[],
  normalization: TradovateNormalizationResult
): TradovateStructuralReport {
  const actions: Record<'Buy' | 'Sell', number> = { Buy: 0, Sell: 0 }
  const contracts = new Set<string>()
  const quantities = new Set<string>()
  let minTimestamp: string | null = null
  let maxTimestamp: string | null = null

  for (const fill of fills) {
    actions[fill.action] += 1
    contracts.add(fill.contractId)
    quantities.add(fill.quantity)
    if (minTimestamp === null || fill.timestamp < minTimestamp) minTimestamp = fill.timestamp
    if (maxTimestamp === null || fill.timestamp > maxTimestamp) maxTimestamp = fill.timestamp
  }

  const sortedQuantities = [...quantities].sort((a, b) => Number(a) - Number(b))

  const ambiguousReversalCases = normalization.unresolved.reduce((sum, u) => sum + u.reversals.length, 0)

  return {
    account: maskTradovateAccountId(accountId),
    accountsFound,
    fillsFound: fills.length,
    positionsFound: positions.length,
    fillPairsFound: fillPairs.length,
    fillFeesFound: fillFees.length,
    fillActions: actions,
    uniqueContracts: contracts.size,
    dateRange: { from: minTimestamp === null ? null : minTimestamp.slice(0, 10), to: maxTimestamp === null ? null : maxTimestamp.slice(0, 10) },
    quantityDistribution: {
      min: sortedQuantities[0] ?? null,
      max: sortedQuantities[sortedQuantities.length - 1] ?? null,
      distinctValues: sortedQuantities.length
    },
    completedCandidates: normalization.completed.length,
    openCandidates: normalization.open.length,
    unresolvedCandidates: normalization.unresolved.length,
    ambiguousReversalCases,
    rejectedFills: normalization.rejected.length
  }
}

export function formatTradovateStructuralReport(report: TradovateStructuralReport): string[] {
  return [
    `account: ${report.account}`,
    `accounts found: ${report.accountsFound}`,
    `fills found: ${report.fillsFound}`,
    `positions found: ${report.positionsFound}`,
    `fillPairs found: ${report.fillPairsFound}`,
    `fillFees found: ${report.fillFeesFound}`,
    `fill actions: Buy: ${report.fillActions.Buy}, Sell: ${report.fillActions.Sell}`,
    `unique contracts: ${report.uniqueContracts}`,
    `date range: ${report.dateRange.from ?? 'n/a'} .. ${report.dateRange.to ?? 'n/a'}`,
    `quantity distribution: min ${report.quantityDistribution.min ?? 'n/a'}, max ${report.quantityDistribution.max ?? 'n/a'}, distinct ${report.quantityDistribution.distinctValues}`,
    `completed round trips: ${report.completedCandidates}`,
    `open positions (from-fills): ${report.openCandidates}`,
    `unresolved segments: ${report.unresolvedCandidates}`,
    `ambiguous/reversal cases: ${report.ambiguousReversalCases}`,
    `rejected fills: ${report.rejectedFills}`
  ]
}
