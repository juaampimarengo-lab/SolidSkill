/**
 * Structure-only statistics about a set of raw deals and their normalization.
 * Diagnostics for QA, NOT an import: contains counts and masked identity only
 * (no prices, volumes, profits, tickets, or unmasked account login).
 */
import type { RawMt5Deal } from '../protocol'
import { dealEntryLabel, dealTypeLabel } from '../protocol'
import type { Mt5NormalizationResult } from './types'

export interface StructuralReport {
  readonly account: string
  readonly accounting: string | null
  readonly totalRawDeals: number
  readonly uniqueDealIdentities: number
  readonly duplicateDealsDropped: number
  readonly tradingDeals: number
  readonly nonTradingDeals: number
  readonly rejectedDeals: number
  readonly uniquePositionIds: number
  readonly dealTypeDistribution: Readonly<Record<string, number>>
  readonly dealEntryDistribution: Readonly<Record<string, number>>
  readonly completedLifecycles: number
  readonly openLifecycles: number
  readonly unresolvedLifecycles: number
  readonly unresolvedReasons: Readonly<Record<string, number>>
  readonly inoutDeals: number
  readonly outByDeals: number
}

/** "***" + last 3 digits: tells accounts apart without identifying one. */
function maskAccount(login: string): string {
  return `***${login.slice(-3)}`
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

export function buildStructuralReport(deals: readonly RawMt5Deal[], result: Mt5NormalizationResult): StructuralReport {
  const types: Record<string, number> = {}
  const entries: Record<string, number> = {}
  const positions = new Set<string>()
  const identities = new Set<string>()
  let inout = 0
  let outBy = 0
  for (const d of deals) {
    identities.add(d.dealTicket)
    bump(types, dealTypeLabel(d.dealType) ?? `UNKNOWN(${d.dealType})`)
    if (d.dealType === 0 || d.dealType === 1) {
      bump(entries, dealEntryLabel(d.dealEntry) ?? `UNSUPPORTED(${d.dealEntry})`)
      if (d.positionId !== '0') positions.add(d.positionId)
      if (d.dealEntry === 2) inout += 1
      if (d.dealEntry === 3) outBy += 1
    }
  }
  const reasons: Record<string, number> = {}
  for (const u of result.unresolved) for (const r of u.reasons) bump(reasons, r)
  return {
    account: maskAccount(result.account.accountLogin),
    accounting: result.account.accounting,
    totalRawDeals: deals.length,
    uniqueDealIdentities: identities.size,
    duplicateDealsDropped: result.stats.duplicateDealsDropped,
    tradingDeals: result.stats.tradingDeals,
    nonTradingDeals: result.stats.ignoredDeals,
    rejectedDeals: result.stats.rejectedDeals,
    uniquePositionIds: positions.size,
    dealTypeDistribution: types,
    dealEntryDistribution: entries,
    completedLifecycles: result.stats.completed,
    openLifecycles: result.stats.open,
    unresolvedLifecycles: result.stats.unresolved,
    unresolvedReasons: reasons,
    inoutDeals: inout,
    outByDeals: outBy
  }
}
