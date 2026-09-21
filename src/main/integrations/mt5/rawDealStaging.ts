/**
 * In-memory staging of raw MT5 deals, deduplicated by stable source identity.
 *
 * This is deliberately NOT persistence: the spike does not add a migration for
 * unproven MT5 assumptions. Contents are lost on restart, and that is safe
 * because the EA replays MT5's own deal history on every (re)connect.
 *
 * Staging stores facts as reported. It derives nothing: no direction, no
 * position grouping, no trades.
 */
import type { Mt5Origin, RawMt5Deal } from './protocol'

/**
 * Stable identity of a raw MT5 deal: source + server + account login + deal
 * ticket. JSON-encoded so no delimiter ambiguity is possible. Timestamp,
 * symbol, position id and arrival order are NOT part of identity.
 */
export function rawDealIdentity(deal: Pick<RawMt5Deal, 'source' | 'server' | 'accountLogin' | 'dealTicket'>): string {
  return JSON.stringify([deal.source, deal.server, deal.accountLogin, deal.dealTicket])
}

export interface StagedDeal {
  readonly identity: string
  readonly deal: RawMt5Deal
  /** Monotonic receive counter: proves arrival order was preserved, never used to order facts. */
  readonly arrivalSeq: number
  readonly origin: Mt5Origin
  readonly syncId: string | null
}

export type StageOutcome = 'accepted' | 'duplicate' | 'conflict' | 'capacity'

export class RawDealStaging {
  private readonly byIdentity = new Map<string, StagedDeal>()
  private nextSeq = 1
  private conflictCount = 0

  constructor(private readonly maxDeals: number = 200_000) {}

  /**
   * Same identity + same facts -> 'duplicate' (harmless replay).
   * Same identity + DIFFERENT facts -> 'conflict': the first-seen record is
   * kept untouched (MT5 deals are immutable, so a differing replay signals a
   * misbehaving sender, and history must not silently change).
   */
  stage(deal: RawMt5Deal, origin: Mt5Origin, syncId: string | null): StageOutcome {
    const identity = rawDealIdentity(deal)
    const existing = this.byIdentity.get(identity)
    if (existing !== undefined) {
      if (JSON.stringify(existing.deal) === JSON.stringify(deal)) return 'duplicate'
      this.conflictCount += 1
      return 'conflict'
    }
    if (this.byIdentity.size >= this.maxDeals) return 'capacity'
    this.byIdentity.set(identity, { identity, deal, arrivalSeq: this.nextSeq++, origin, syncId })
    return 'accepted'
  }

  get size(): number {
    return this.byIdentity.size
  }

  get conflicts(): number {
    return this.conflictCount
  }

  get(identity: string): StagedDeal | undefined {
    return this.byIdentity.get(identity)
  }

  /** In arrival order. */
  list(): readonly StagedDeal[] {
    return [...this.byIdentity.values()]
  }

  clear(): void {
    this.byIdentity.clear()
    this.conflictCount = 0
  }
}
