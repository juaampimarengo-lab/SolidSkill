/**
 * The ONLY surface through which the Tradovate adapter talks to a
 * transport (real HTTP/WebSocket client, or a fake for tests).
 *
 * READ-ONLY BY CONSTRUCTION: this interface has no method that can place,
 * modify, or cancel an order, or flatten/modify a position or bracket. If a
 * future real client library exposes such methods, the adapter must not
 * surface them — nothing here can even call them, because they are not part
 * of this type. `npm run smoke:tradovate` statically scans this whole
 * directory and fails if a forbidden trading term appears anywhere.
 *
 * No credentials are logged or included in any event this interface can
 * produce. See docs/TRADOVATE_INTEGRATION_SPIKE.md, "Auth / secrets".
 */
import type { RawTradovateAccount, RawTradovateContract, RawTradovateFill } from './protocol'

export interface TradovateCredentials {
  readonly name: string
  readonly password: string
  readonly appId: string
  readonly appVersion: string
  readonly cid: string
  readonly sec: string
}

export interface TradovateSession {
  readonly accessToken: string
  readonly mdAccessToken: string | null
  /** Epoch ms. The adapter must renew before this, never after (see spike doc, "Auth / session findings"). */
  readonly expiresAtMsc: number
  readonly userId: string
}

export interface HistoricalFillRange {
  /** Inclusive. ISO-8601 UTC, matching the source timestamp convention. */
  readonly fromTimestamp: string
  /** Inclusive. */
  readonly toTimestamp: string
}

/**
 * Read-only capability set a Tradovate transport must provide. Every method
 * name here is a GET-shaped read. There is intentionally no `placeOrder`,
 * `cancelOrder`, `modifyOrder`, `flattenPosition`, `liquidatePosition`, or
 * bracket/stop/target mutator anywhere in this file.
 */
export interface TradovateTransport {
  authenticate(credentials: TradovateCredentials): Promise<TradovateSession>
  renewSession(session: TradovateSession): Promise<TradovateSession>
  listAccounts(session: TradovateSession): Promise<readonly RawTradovateAccount[]>
  listContracts(session: TradovateSession, contractIds: readonly string[]): Promise<readonly RawTradovateContract[]>
  /** Historical fills for one account within a range. Pagination behavior: see docs/TRADOVATE_RAW_CONTRACT.md §11. */
  listHistoricalFills(
    session: TradovateSession,
    accountId: string,
    range: HistoricalFillRange
  ): Promise<readonly RawTradovateFill[]>
  /**
   * Opens a read-only live event subscription for one account (the
   * documented `user/syncrequest` WebSocket model — see spike doc,
   * "Live-event path"). `onFill` fires once per newly observed live fill.
   * Returns an unsubscribe function; calling it closes the subscription only
   * (never anything account-affecting).
   */
  subscribeToFills(session: TradovateSession, accountId: string, onFill: (fill: RawTradovateFill) => void): () => void
  disconnect(session: TradovateSession): Promise<void>
}
