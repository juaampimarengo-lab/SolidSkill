/**
 * Tradovate read-only adapter. This is the ONLY object above `transport.ts`
 * that talks to Tradovate; the Normalization Layer and everything above it
 * never see a `TradovateTransport` directly (see docs/ARCHITECTURE.md,
 * "Broker / Platform Adapters").
 *
 * READ-ONLY: no method here can place, modify, or cancel an order, or touch
 * a position/bracket/stop/target. The adapter cannot expose trading even if
 * a future real `TradovateTransport` implementation's underlying SDK has
 * write methods, because `TradovateTransport` (transport.ts) has no such
 * method to call in the first place.
 */
import type { RawTradovateAccount, RawTradovateFill } from './protocol'
import type { HistoricalFillRange, TradovateCredentials, TradovateSession, TradovateTransport } from './transport'
import { TradovateRawStaging } from './rawStaging'

export interface TradovateAdapterAccount {
  readonly account: RawTradovateAccount
}

export type TradovateAdapterEvent =
  | { readonly kind: 'connected'; readonly userId: string }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'history_synced'; readonly accountId: string; readonly received: number; readonly staged: number; readonly duplicates: number; readonly conflicts: number }
  | { readonly kind: 'live_fill_staged'; readonly accountId: string; readonly outcome: 'accepted' | 'duplicate' | 'conflict' | 'capacity' }
  | { readonly kind: 'auth_error'; readonly message: string }

export interface TradovateAdapterOptions {
  readonly transport: TradovateTransport
  readonly onEvent?: (event: TradovateAdapterEvent) => void
}

/**
 * connect -> listAccounts -> getHistoricalSourceFacts -> subscribeToSourceFacts -> disconnect.
 * Exactly this shape, per docs/TRADOVATE_INTEGRATION_SPIKE.md, "Adapter interface".
 */
export class TradovateAdapter {
  private readonly transport: TradovateTransport
  private readonly onEvent: (event: TradovateAdapterEvent) => void
  private readonly staging = new TradovateRawStaging()
  private session: TradovateSession | null = null
  private readonly unsubscribers = new Map<string, () => void>()

  constructor(options: TradovateAdapterOptions) {
    this.transport = options.transport
    this.onEvent = options.onEvent ?? ((): void => {})
  }

  async connect(credentials: TradovateCredentials): Promise<void> {
    try {
      this.session = await this.transport.authenticate(credentials)
      this.onEvent({ kind: 'connected', userId: this.session.userId })
    } catch (error) {
      this.onEvent({ kind: 'auth_error', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async listAccounts(): Promise<readonly RawTradovateAccount[]> {
    const session = this.requireSession()
    return this.transport.listAccounts(session)
  }

  /**
   * Pulls historical fills for one account into raw staging and returns the
   * staged facts for that account. Nothing is normalized or persisted here —
   * see docs/TRADOVATE_NORMALIZATION plans in the spike doc's "Next steps".
   */
  async getHistoricalSourceFacts(accountId: string, range: HistoricalFillRange): Promise<readonly RawTradovateFill[]> {
    const session = this.requireSession()
    const fills = await this.transport.listHistoricalFills(session, accountId, range)
    let staged = 0
    let duplicates = 0
    let conflicts = 0
    for (const fill of fills) {
      const outcome = this.staging.stage(fill)
      if (outcome === 'accepted') staged += 1
      else if (outcome === 'duplicate') duplicates += 1
      else if (outcome === 'conflict') conflicts += 1
    }
    this.onEvent({ kind: 'history_synced', accountId, received: fills.length, staged, duplicates, conflicts })
    return this.staging.listForAccount(accountId).map((s) => s.fill)
  }

  /** Opens a live read-only subscription; staged fills accumulate the same way as history. */
  subscribeToSourceFacts(accountId: string): void {
    const session = this.requireSession()
    this.unsubscribers.get(accountId)?.()
    const unsubscribe = this.transport.subscribeToFills(session, accountId, (fill) => {
      const outcome = this.staging.stage(fill)
      this.onEvent({ kind: 'live_fill_staged', accountId, outcome })
    })
    this.unsubscribers.set(accountId, unsubscribe)
  }

  unsubscribeFromSourceFacts(accountId: string): void {
    this.unsubscribers.get(accountId)?.()
    this.unsubscribers.delete(accountId)
  }

  getStagedFills(accountId: string): readonly RawTradovateFill[] {
    return this.staging.listForAccount(accountId).map((s) => s.fill)
  }

  async disconnect(): Promise<void> {
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe()
    this.unsubscribers.clear()
    if (this.session !== null) {
      await this.transport.disconnect(this.session)
      this.session = null
    }
    this.onEvent({ kind: 'disconnected' })
  }

  private requireSession(): TradovateSession {
    if (this.session === null) throw new Error('TradovateAdapter: not connected')
    return this.session
  }
}
