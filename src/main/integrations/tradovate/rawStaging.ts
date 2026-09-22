/**
 * In-memory staging of raw Tradovate fills, deduplicated by stable source
 * identity. Deliberately NOT persistence (no migration, no table) — mirrors
 * the MT5 spike's staging decision but is its own independent implementation
 * (see docs/TRADOVATE_INTEGRATION_SPIKE.md, "Raw staging").
 *
 * Stores facts as reported. Derives nothing: no direction, no lifecycle
 * grouping, no Trades.
 */
import type { RawTradovateFill } from './protocol'
import { rawFillIdentity } from './protocol'

export interface StagedFill {
  readonly identity: string
  readonly fill: RawTradovateFill
  /** Monotonic receive counter: proves arrival order was preserved, never used to order facts. */
  readonly arrivalSeq: number
}

export type StageOutcome = 'accepted' | 'duplicate' | 'conflict' | 'capacity'

export class TradovateRawStaging {
  private readonly byIdentity = new Map<string, StagedFill>()
  private nextSeq = 1
  private conflictCount = 0

  constructor(private readonly maxFills: number = 200_000) {}

  /**
   * Same identity + same facts -> 'duplicate' (harmless replay).
   * Same identity + DIFFERENT facts -> 'conflict': the first-seen record is
   * kept untouched (fills are immutable execution facts; a differing replay
   * signals a misbehaving/inconsistent source, never a silent history change).
   */
  stage(fill: RawTradovateFill): StageOutcome {
    const identity = rawFillIdentity(fill)
    const existing = this.byIdentity.get(identity)
    if (existing !== undefined) {
      if (JSON.stringify(existing.fill) === JSON.stringify(fill)) return 'duplicate'
      this.conflictCount += 1
      return 'conflict'
    }
    if (this.byIdentity.size >= this.maxFills) return 'capacity'
    this.byIdentity.set(identity, { identity, fill, arrivalSeq: this.nextSeq++ })
    return 'accepted'
  }

  get size(): number {
    return this.byIdentity.size
  }

  get conflicts(): number {
    return this.conflictCount
  }

  get(identity: string): StagedFill | undefined {
    return this.byIdentity.get(identity)
  }

  /** In arrival order. */
  list(): readonly StagedFill[] {
    return [...this.byIdentity.values()]
  }

  /** Fills for one account only — accounts never mix in a lifecycle reconstruction. */
  listForAccount(accountId: string): readonly StagedFill[] {
    return this.list().filter((s) => s.fill.accountId === accountId)
  }

  clear(): void {
    this.byIdentity.clear()
    this.conflictCount = 0
  }
}
