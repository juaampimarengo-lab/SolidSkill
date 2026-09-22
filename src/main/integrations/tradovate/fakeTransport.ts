/**
 * Fake, in-memory implementation of `TradovateTransport` for tests. Speaks no
 * network; lets the adapter and normalizer be proven WITHOUT real Tradovate
 * credentials or access, per docs/TRADOVATE_INTEGRATION_SPIKE.md, "Real access gate".
 *
 * Also has no write-capable method, for the same reason `transport.ts` does not.
 */
import type {
  RawTradovateAccount,
  RawTradovateContract,
  RawTradovateFill,
  RawTradovateFillFee,
  RawTradovateFillPair,
  RawTradovateOrder,
  RawTradovatePosition
} from './protocol'
import type {
  HistoricalFillRange,
  TradovateCredentials,
  TradovateSession,
  TradovateTransport
} from './transport'

export interface FakeTradovateTransportOptions {
  readonly accounts: readonly RawTradovateAccount[]
  readonly contracts?: readonly RawTradovateContract[]
  /** Fills returned by listHistoricalFills, filtered by accountId + range at call time. */
  readonly history?: readonly RawTradovateFill[]
  readonly orders?: readonly RawTradovateOrder[]
  readonly positions?: readonly RawTradovatePosition[]
  readonly fillPairs?: readonly RawTradovateFillPair[]
  readonly fillFees?: readonly RawTradovateFillFee[]
  readonly rejectAuth?: boolean
}

export class FakeTradovateTransport implements TradovateTransport {
  private readonly accounts: readonly RawTradovateAccount[]
  private readonly contracts: readonly RawTradovateContract[]
  private readonly history: readonly RawTradovateFill[]
  private readonly orders: readonly RawTradovateOrder[]
  private readonly positions: readonly RawTradovatePosition[]
  private readonly fillPairs: readonly RawTradovateFillPair[]
  private readonly fillFees: readonly RawTradovateFillFee[]
  private readonly rejectAuth: boolean
  private readonly liveSubscribers = new Map<string, Set<(fill: RawTradovateFill) => void>>()
  private authenticateCalls = 0
  private disconnectCalls = 0

  constructor(options: FakeTradovateTransportOptions) {
    this.accounts = options.accounts
    this.contracts = options.contracts ?? []
    this.history = options.history ?? []
    this.orders = options.orders ?? []
    this.positions = options.positions ?? []
    this.fillPairs = options.fillPairs ?? []
    this.fillFees = options.fillFees ?? []
    this.rejectAuth = options.rejectAuth ?? false
  }

  async authenticate(credentials: TradovateCredentials): Promise<TradovateSession> {
    this.authenticateCalls += 1
    if (this.rejectAuth) throw new Error('invalid credentials')
    return {
      accessToken: `fake-token-for-${credentials.name}`,
      mdAccessToken: null,
      expiresAtMsc: Date.now() + 80 * 60 * 1000,
      userId: `user-${credentials.name}`
    }
  }

  async renewSession(session: TradovateSession): Promise<TradovateSession> {
    return { ...session, expiresAtMsc: Date.now() + 80 * 60 * 1000 }
  }

  async listAccounts(): Promise<readonly RawTradovateAccount[]> {
    return this.accounts
  }

  async listContracts(_session: TradovateSession, contractIds: readonly string[]): Promise<readonly RawTradovateContract[]> {
    return this.contracts.filter((c) => contractIds.includes(c.id))
  }

  async listHistoricalFills(
    _session: TradovateSession,
    accountId: string,
    range: HistoricalFillRange
  ): Promise<readonly RawTradovateFill[]> {
    return this.history.filter(
      (f) => f.accountId === accountId && f.timestamp >= range.fromTimestamp && f.timestamp <= range.toTimestamp
    )
  }

  subscribeToFills(_session: TradovateSession, accountId: string, onFill: (fill: RawTradovateFill) => void): () => void {
    const set = this.liveSubscribers.get(accountId) ?? new Set()
    set.add(onFill)
    this.liveSubscribers.set(accountId, set)
    return (): void => {
      this.liveSubscribers.get(accountId)?.delete(onFill)
    }
  }

  async listOrders(_session: TradovateSession, accountId: string): Promise<readonly RawTradovateOrder[]> {
    return this.orders.filter((o) => o.accountId === accountId)
  }

  async listPositions(_session: TradovateSession, accountId: string): Promise<readonly RawTradovatePosition[]> {
    return this.positions.filter((p) => p.accountId === accountId)
  }

  async listFillPairs(_session: TradovateSession, _accountId: string): Promise<readonly RawTradovateFillPair[]> {
    return this.fillPairs
  }

  async listFillFees(_session: TradovateSession, fillIds: readonly string[]): Promise<readonly RawTradovateFillFee[]> {
    return this.fillFees.filter((f) => f.attributedFillId !== null && fillIds.includes(f.attributedFillId))
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1
  }

  /** Test helper: pushes a fake live fill to every current subscriber of an account. */
  emitLiveFill(fill: RawTradovateFill): void {
    for (const listener of this.liveSubscribers.get(fill.accountId) ?? []) listener(fill)
  }

  get diagnostics(): { readonly authenticateCalls: number; readonly disconnectCalls: number; readonly liveSubscriberAccounts: readonly string[] } {
    return {
      authenticateCalls: this.authenticateCalls,
      disconnectCalls: this.disconnectCalls,
      liveSubscriberAccounts: [...this.liveSubscribers.keys()]
    }
  }
}
