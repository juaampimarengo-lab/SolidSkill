/**
 * Development sender that emulates the MT5 EA wire protocol (v1) so the
 * receiver can be exercised with no MetaTrader installed. Send-only, like
 * the real EA. Never used by the application itself.
 */
import { connect, type Socket } from 'node:net'

export type Wire = Record<string, unknown>

export interface DealSpec {
  ticket: string
  order?: string
  position: string
  timeMsc: number
  symbol?: string | null
  /** ENUM_DEAL_TYPE: 0 BUY, 1 SELL, 2 BALANCE ... */
  type: number
  /** ENUM_DEAL_ENTRY: 0 IN, 1 OUT, 2 INOUT, 3 OUT_BY */
  entry: number
  volume: string
  price: string
  profit?: string | null
  commission?: string | null
  fee?: string | null
  swap?: string | null
  magic?: string
  reason?: number
  externalId?: string | null
}

export interface AccountSpec {
  login: string
  server: string
  /** 0 netting, 1 exchange, 2 hedging */
  marginMode: number
}

export const DEMO_NETTING: AccountSpec = { login: '1000001', server: 'Demo-Server', marginMode: 0 }
export const DEMO_HEDGING: AccountSpec = { login: '1000002', server: 'Demo-Server', marginMode: 2 }

export function helloFrame(account: AccountSpec, extra: Wire = {}): Wire {
  return {
    v: 1,
    type: 'hello',
    source: 'MT5',
    eaVersion: '1.0.0-test',
    account: {
      login: account.login,
      server: account.server,
      company: 'Demo Broker Ltd',
      currency: 'USD',
      marginMode: account.marginMode,
      tradeMode: 0,
      hedgeCapable: account.marginMode === 2
    },
    terminal: { build: 5000, name: 'MetaTrader 5' },
    ...extra
  }
}

export function dealFrame(
  account: AccountSpec,
  spec: DealSpec,
  origin: 'live' | 'history' = 'live',
  syncId: string | null = null
): Wire {
  return {
    v: 1,
    type: 'deal',
    source: 'MT5',
    origin,
    syncId: origin === 'history' ? syncId : null,
    server: account.server,
    accountLogin: account.login,
    dealTicket: spec.ticket,
    orderTicket: spec.order ?? spec.ticket,
    positionId: spec.position,
    externalId: spec.externalId ?? null,
    timeMsc: spec.timeMsc,
    symbol: spec.symbol === undefined ? 'EURUSD' : spec.symbol,
    dealType: spec.type,
    dealEntry: spec.entry,
    volume: spec.volume,
    price: spec.price,
    profit: spec.profit === undefined ? '0.00000000' : spec.profit,
    commission: spec.commission === undefined ? '0.00000000' : spec.commission,
    fee: spec.fee === undefined ? '0.00000000' : spec.fee,
    swap: spec.swap === undefined ? '0.00000000' : spec.swap,
    magic: spec.magic ?? '0',
    reason: spec.reason ?? 0
  }
}

export class FakeEa {
  private socket: Socket | null = null
  private closed = false

  constructor(
    private readonly port: number,
    private readonly host: string = '127.0.0.1'
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port }, () => resolve())
      socket.on('error', (error) => {
        if (this.socket === null) reject(error)
      })
      socket.on('close', () => {
        this.closed = true
      })
      this.socket = socket
    })
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** Writes raw bytes with no framing help (used for malformed-input cases). */
  sendRaw(data: string | Buffer): void {
    if (this.socket !== null && !this.socket.destroyed) this.socket.write(data)
  }

  send(frame: Wire): void {
    this.sendRaw(`${JSON.stringify(frame)}\n`)
  }

  hello(account: AccountSpec, extra: Wire = {}): void {
    this.send(helloFrame(account, extra))
  }

  deal(account: AccountSpec, spec: DealSpec): void {
    this.send(dealFrame(account, spec, 'live'))
  }

  /**
   * history_begin, one history deal per spec (in the given order), history_end.
   * By default the EA "discovered" exactly what it sent. Override `counts` to
   * emulate an EA that discovered more deals than it could read.
   */
  historySync(
    account: AccountSpec,
    syncId: string,
    specs: readonly DealSpec[],
    counts: { discovered?: number; sent?: number; failed?: number } = {}
  ): void {
    this.send({ v: 1, type: 'history_begin', syncId })
    for (const spec of specs) this.send(dealFrame(account, spec, 'history', syncId))
    this.send({
      v: 1,
      type: 'history_end',
      syncId,
      discovered: counts.discovered ?? specs.length,
      sent: counts.sent ?? specs.length,
      failed: counts.failed ?? 0
    })
  }

  heartbeat(): void {
    this.send({ v: 1, type: 'heartbeat' })
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const socket = this.socket
      if (socket === null || socket.destroyed) {
        resolve()
        return
      }
      socket.once('close', () => resolve())
      socket.end()
    })
  }

  destroy(): void {
    this.socket?.destroy()
  }
}
