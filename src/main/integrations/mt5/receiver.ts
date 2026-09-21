/**
 * Loopback-only TCP receiver for the Solid Skill MT5 Read-Only Bridge.
 *
 * Data flows ONE WAY: EA -> receiver. The receiver never writes to the socket,
 * never interprets anything as a command, executes nothing, and touches no
 * filesystem path supplied by the peer. MT5 being offline or disconnecting is
 * normal and never an application error.
 *
 * Output is raw staged deals + diagnostics only. Nothing here creates Trades.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import {
  DEFAULT_MAX_FRAME_BYTES,
  DEFAULT_MT5_BRIDGE_PORT,
  parseFrame,
  positionAccountingOf,
  type Mt5DealMessage,
  type Mt5HelloMessage,
  type Mt5Message,
  type PositionAccounting
} from './protocol'
import { RawDealStaging, type StagedDeal } from './rawDealStaging'

export type LoopbackHost = '127.0.0.1' | '::1'

export interface Mt5ReceiverOptions {
  /** Loopback only. Anything else throws at construction. */
  readonly host?: LoopbackHost
  /** 0 picks an ephemeral port (tests). */
  readonly port?: number
  /** When set, hello must carry the same pairing key or the peer is dropped. */
  readonly bridgeKey?: string | null
  readonly maxFrameBytes?: number
  readonly maxConnections?: number
  /** A peer must complete hello within this window. */
  readonly handshakeTimeoutMs?: number
  /** Drop a peer silent for this long (the EA heartbeats every 15 s). */
  readonly idleTimeoutMs?: number
  /** Invalid frames tolerated per authenticated connection before dropping. */
  readonly maxRejectsPerConnection?: number
  readonly maxStagedDeals?: number
  readonly onEvent?: (event: Mt5BridgeEvent) => void
  readonly now?: () => number
}

/** Diagnostic events. Never carry prices, volumes, keys, or full account logins. */
export type Mt5BridgeEvent =
  | { readonly kind: 'listening'; readonly host: string; readonly port: number }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'listen_error'; readonly message: string }
  | { readonly kind: 'connected'; readonly connectionId: number }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'hello'; readonly connectionId: number; readonly account: string; readonly accounting: PositionAccounting | null }
  | { readonly kind: 'history_begin'; readonly account: string; readonly syncId: string }
  | {
      readonly kind: 'history_end'
      readonly account: string
      readonly syncId: string
      readonly status: 'complete' | 'incomplete'
      readonly discovered: number
      readonly sent: number
      readonly failed: number
      readonly received: number
      readonly accepted: number
      readonly duplicates: number
    }
  | { readonly kind: 'deal_accepted'; readonly account: string }
  | { readonly kind: 'duplicate_ignored'; readonly account: string }
  | { readonly kind: 'deal_conflict'; readonly account: string }
  | {
      readonly kind: 'ea_error'
      readonly account: string
      readonly code: string
      readonly stage: string | null
      readonly index: number | null
      readonly lastError: number | null
      readonly dealTicket: string | null
    }
  | { readonly kind: 'frame_rejected'; readonly connectionId: number; readonly reason: string }
  | { readonly kind: 'dropped'; readonly connectionId: number; readonly reason: string }
  | { readonly kind: 'disconnected'; readonly connectionId: number; readonly account: string | null }

export interface SyncSummary {
  readonly syncId: string
  readonly status: 'in_progress' | 'complete' | 'incomplete' | 'aborted'
  /** Deals MT5 reported for the window (HistoryDealsTotal); null until history_end. */
  readonly discovered: number | null
  /** Deals the EA says it read and sent; null until history_end. */
  readonly sent: number | null
  /** Deals the EA says it could not read; null until history_end. */
  readonly failed: number | null
  readonly received: number
  readonly accepted: number
  readonly duplicates: number
}

export interface Mt5AccountStatus {
  readonly server: string
  readonly login: string
  readonly company: string | null
  readonly currency: string
  readonly marginMode: number
  readonly positionAccounting: PositionAccounting | null
  readonly tradeMode: number | null
  readonly hedgeCapable: boolean | null
  readonly eaVersion: string
  readonly terminalBuild: number | null
  readonly connected: boolean
  readonly lastHelloAt: number
  readonly lastHeartbeatAt: number | null
  readonly lastSync: SyncSummary | null
  readonly dealsAccepted: number
  readonly duplicatesIgnored: number
  /** Deals the EA reported it could not read and that have not arrived since. */
  readonly unresolvedDealTickets: readonly string[]
}

export interface Mt5ReceiverStats {
  readonly connectionsOpened: number
  readonly connectionsClosed: number
  readonly connectionsRefused: number
  readonly framesReceived: number
  readonly framesRejected: number
  readonly dealsAccepted: number
  readonly duplicatesIgnored: number
  readonly conflicts: number
  readonly capacityRejected: number
}

export interface Mt5ReceiverStatus {
  readonly listening: boolean
  readonly address: { readonly host: string; readonly port: number } | null
  readonly connections: number
  readonly stagedDeals: number
  readonly accounts: readonly Mt5AccountStatus[]
  readonly stats: Mt5ReceiverStats
}

interface MutableSync {
  syncId: string
  status: SyncSummary['status']
  discovered: number | null
  sent: number | null
  failed: number | null
  received: number
  accepted: number
  duplicates: number
}

interface AccountRecord {
  key: string
  server: string
  login: string
  company: string | null
  currency: string
  marginMode: number
  tradeMode: number | null
  hedgeCapable: boolean | null
  eaVersion: string
  terminalBuild: number | null
  activeConnections: number
  lastHelloAt: number
  lastHeartbeatAt: number | null
  lastSync: MutableSync | null
  dealsAccepted: number
  duplicatesIgnored: number
  unresolved: Set<string>
}

interface Connection {
  readonly id: number
  readonly socket: Socket
  pending: Buffer
  account: AccountRecord | null
  sync: MutableSync | null
  rejects: number
  closed: boolean
}

const MAX_UNRESOLVED_TICKETS = 1000

export function accountKey(server: string, login: string): string {
  return JSON.stringify([server, login])
}

/** "***" + last 3 digits: enough to tell accounts apart in logs, not to identify one. */
export function maskAccount(login: string): string {
  return `***${login.slice(-3)}`
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  return address === '::1' || address === '127.0.0.1' || address.startsWith('127.') || address === '::ffff:127.0.0.1'
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export class Mt5Receiver {
  readonly staging: RawDealStaging
  private readonly host: LoopbackHost
  private readonly requestedPort: number
  private readonly bridgeKeyDigest: Buffer | null
  private readonly maxFrameBytes: number
  private readonly maxConnections: number
  private readonly handshakeTimeoutMs: number
  private readonly idleTimeoutMs: number
  private readonly maxRejects: number
  private readonly onEvent: (event: Mt5BridgeEvent) => void
  private readonly now: () => number

  private server: Server | null = null
  private boundPort: number | null = null
  private readonly connections = new Set<Connection>()
  private readonly accounts = new Map<string, AccountRecord>()
  private nextConnectionId = 1
  private counters = {
    connectionsOpened: 0,
    connectionsClosed: 0,
    connectionsRefused: 0,
    framesReceived: 0,
    framesRejected: 0,
    dealsAccepted: 0,
    duplicatesIgnored: 0,
    conflicts: 0,
    capacityRejected: 0
  }

  constructor(options: Mt5ReceiverOptions = {}) {
    const host = options.host ?? '127.0.0.1'
    // The bridge must never be reachable from the LAN or the Internet.
    if (host !== '127.0.0.1' && host !== '::1') {
      throw new Error('MT5 bridge may only bind to a loopback address')
    }
    this.host = host
    this.requestedPort = options.port ?? DEFAULT_MT5_BRIDGE_PORT
    this.bridgeKeyDigest = options.bridgeKey ? digest(options.bridgeKey) : null
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
    this.maxConnections = options.maxConnections ?? 8
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000
    this.maxRejects = options.maxRejectsPerConnection ?? 10
    this.onEvent = options.onEvent ?? (() => undefined)
    this.now = options.now ?? Date.now
    this.staging = new RawDealStaging(options.maxStagedDeals)
  }

  /** Resolves with the bound port; rejects (e.g. EADDRINUSE) without touching app state. */
  start(): Promise<number> {
    if (this.server !== null && this.boundPort !== null) return Promise.resolve(this.boundPort)
    return new Promise<number>((resolve, reject) => {
      const server = createServer((socket) => this.handleConnection(socket))
      const onStartError = (error: Error): void => {
        this.emit({ kind: 'listen_error', message: error.message })
        reject(error)
      }
      server.once('error', onStartError)
      server.listen({ host: this.host, port: this.requestedPort }, () => {
        server.off('error', onStartError)
        // A runtime server error must never become an uncaught exception.
        server.on('error', (error) => this.emit({ kind: 'listen_error', message: error.message }))
        const address = server.address()
        const port = typeof address === 'object' && address !== null ? address.port : this.requestedPort
        this.server = server
        this.boundPort = port
        this.emit({ kind: 'listening', host: this.host, port })
        resolve(port)
      })
    })
  }

  /** Closes the listener and every connection. Idempotent. */
  stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.boundPort = null
    for (const connection of [...this.connections]) this.dropConnection(connection, 'receiver stopping')
    if (server === null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      server.close(() => {
        this.emit({ kind: 'stopped' })
        resolve()
      })
    })
  }

  getStatus(): Mt5ReceiverStatus {
    return {
      listening: this.server !== null,
      address: this.boundPort === null ? null : { host: this.host, port: this.boundPort },
      connections: this.connections.size,
      stagedDeals: this.staging.size,
      accounts: [...this.accounts.values()].map((a) => this.toAccountStatus(a)),
      stats: { ...this.counters, conflicts: this.staging.conflicts }
    }
  }

  getStagedDeals(): readonly StagedDeal[] {
    return this.staging.list()
  }

  // -------------------------------------------------------------------------

  private emit(event: Mt5BridgeEvent): void {
    try {
      this.onEvent(event)
    } catch {
      // A faulty diagnostics sink must never affect ingestion.
    }
  }

  private handleConnection(socket: Socket): void {
    if (!isLoopbackAddress(socket.remoteAddress)) {
      this.counters.connectionsRefused += 1
      this.emit({ kind: 'refused', reason: 'non-loopback peer' })
      socket.destroy()
      return
    }
    if (this.connections.size >= this.maxConnections) {
      this.counters.connectionsRefused += 1
      this.emit({ kind: 'refused', reason: 'too many connections' })
      socket.destroy()
      return
    }
    const connection: Connection = {
      id: this.nextConnectionId++,
      socket,
      pending: Buffer.alloc(0),
      account: null,
      sync: null,
      rejects: 0,
      closed: false
    }
    this.connections.add(connection)
    this.counters.connectionsOpened += 1
    this.emit({ kind: 'connected', connectionId: connection.id })
    socket.setTimeout(this.handshakeTimeoutMs)
    socket.on('data', (chunk: Buffer) => this.onData(connection, chunk))
    socket.on('timeout', () => this.dropConnection(connection, 'timeout'))
    socket.on('error', () => this.dropConnection(connection, 'socket error'))
    socket.on('close', () => this.onClosed(connection))
  }

  private onData(connection: Connection, chunk: Buffer): void {
    if (connection.closed) return
    connection.pending = connection.pending.length === 0 ? chunk : Buffer.concat([connection.pending, chunk])
    for (;;) {
      const newline = connection.pending.indexOf(0x0a)
      if (newline < 0) {
        // No frame boundary yet: a well-behaved EA never buffers this much.
        if (connection.pending.length > this.maxFrameBytes) this.dropConnection(connection, 'oversized frame')
        return
      }
      if (newline > this.maxFrameBytes) {
        this.dropConnection(connection, 'oversized frame')
        return
      }
      const line = connection.pending.subarray(0, newline)
      connection.pending = connection.pending.subarray(newline + 1)
      this.processLine(connection, line)
      if (connection.closed) return
    }
  }

  private processLine(connection: Connection, line: Buffer): void {
    let frame = line.toString('utf8')
    if (frame.endsWith('\r')) frame = frame.slice(0, -1)
    if (frame.trim() === '') return
    this.counters.framesReceived += 1
    const parsed = parseFrame(frame)
    if (!parsed.ok) {
      this.rejectFrame(connection, parsed.reason)
      return
    }
    const message = parsed.message
    if (connection.account === null) {
      // Unauthenticated peers get zero tolerance: hello first, or goodbye.
      if (message.type !== 'hello') {
        this.rejectFrame(connection, 'message before hello')
        return
      }
      this.handleHello(connection, message)
      return
    }
    this.handleMessage(connection, connection.account, message)
  }

  private rejectFrame(connection: Connection, reason: string): void {
    this.counters.framesRejected += 1
    connection.rejects += 1
    this.emit({ kind: 'frame_rejected', connectionId: connection.id, reason })
    if (connection.account === null) this.dropConnection(connection, `rejected before hello: ${reason}`)
    else if (connection.rejects > this.maxRejects) this.dropConnection(connection, 'too many invalid frames')
  }

  private handleHello(connection: Connection, hello: Mt5HelloMessage): void {
    if (this.bridgeKeyDigest !== null) {
      const supplied = hello.bridgeKey === null ? null : digest(hello.bridgeKey)
      if (supplied === null || !timingSafeEqual(supplied, this.bridgeKeyDigest)) {
        this.counters.framesRejected += 1
        this.emit({ kind: 'frame_rejected', connectionId: connection.id, reason: 'bridge key mismatch' })
        this.dropConnection(connection, 'bridge key mismatch')
        return
      }
    }
    const { account } = hello
    const key = accountKey(account.server, account.login)
    let record = this.accounts.get(key)
    if (record === undefined) {
      record = {
        key,
        server: account.server,
        login: account.login,
        company: account.company,
        currency: account.currency,
        marginMode: account.marginMode,
        tradeMode: account.tradeMode,
        hedgeCapable: account.hedgeCapable,
        eaVersion: hello.eaVersion,
        terminalBuild: hello.terminalBuild,
        activeConnections: 0,
        lastHelloAt: this.now(),
        lastHeartbeatAt: null,
        lastSync: null,
        dealsAccepted: 0,
        duplicatesIgnored: 0,
        unresolved: new Set()
      }
      this.accounts.set(key, record)
    } else {
      record.company = account.company
      record.currency = account.currency
      record.marginMode = account.marginMode
      record.tradeMode = account.tradeMode
      record.hedgeCapable = account.hedgeCapable
      record.eaVersion = hello.eaVersion
      record.terminalBuild = hello.terminalBuild
      record.lastHelloAt = this.now()
    }
    record.activeConnections += 1
    connection.account = record
    connection.socket.setTimeout(this.idleTimeoutMs)
    this.emit({
      kind: 'hello',
      connectionId: connection.id,
      account: maskAccount(account.login),
      accounting: positionAccountingOf(account.marginMode)
    })
  }

  private handleMessage(connection: Connection, account: AccountRecord, message: Mt5Message): void {
    switch (message.type) {
      case 'hello':
        this.rejectFrame(connection, 'duplicate hello')
        return
      case 'heartbeat':
        account.lastHeartbeatAt = this.now()
        return
      case 'error':
        if (message.code === 'DEAL_FETCH_FAILED' && message.dealTicket !== null && account.unresolved.size < MAX_UNRESOLVED_TICKETS) {
          account.unresolved.add(message.dealTicket)
        }
        this.emit({
          kind: 'ea_error',
          account: maskAccount(account.login),
          code: message.code,
          stage: message.stage,
          index: message.index,
          lastError: message.lastError,
          dealTicket: message.dealTicket
        })
        return
      case 'history_begin': {
        if (connection.sync !== null && connection.sync.status === 'in_progress') connection.sync.status = 'aborted'
        const sync: MutableSync = {
          syncId: message.syncId,
          status: 'in_progress',
          discovered: null,
          sent: null,
          failed: null,
          received: 0,
          accepted: 0,
          duplicates: 0
        }
        connection.sync = sync
        account.lastSync = sync
        this.emit({ kind: 'history_begin', account: maskAccount(account.login), syncId: message.syncId })
        return
      }
      case 'history_end': {
        const sync = connection.sync
        if (sync === null || sync.status !== 'in_progress' || sync.syncId !== message.syncId) {
          this.rejectFrame(connection, 'history_end without matching history_begin')
          return
        }
        sync.discovered = message.discovered
        sync.sent = message.sent
        sync.failed = message.failed
        // Complete only if MT5 gave us everything it listed: nothing failed on
        // the EA side, everything discovered was sent, and everything sent arrived.
        sync.status =
          message.failed === 0 && message.sent === message.discovered && sync.received === message.sent
            ? 'complete'
            : 'incomplete'
        connection.sync = null
        this.emit({
          kind: 'history_end',
          account: maskAccount(account.login),
          syncId: sync.syncId,
          status: sync.status,
          discovered: message.discovered,
          sent: message.sent,
          failed: message.failed,
          received: sync.received,
          accepted: sync.accepted,
          duplicates: sync.duplicates
        })
        return
      }
      case 'deal':
        this.handleDeal(connection, account, message)
        return
    }
  }

  private handleDeal(connection: Connection, account: AccountRecord, message: Mt5DealMessage): void {
    const { deal } = message
    // A connection speaks for exactly the account it introduced itself as.
    if (accountKey(deal.server, deal.accountLogin) !== account.key) {
      this.rejectFrame(connection, 'deal account does not match hello')
      return
    }
    let sync: MutableSync | null = null
    if (message.origin === 'history') {
      sync = connection.sync
      if (sync === null || sync.status !== 'in_progress' || sync.syncId !== message.syncId) {
        this.rejectFrame(connection, 'history deal without an active matching sync')
        return
      }
      sync.received += 1
    }
    const outcome = this.staging.stage(deal, message.origin, message.syncId)
    const masked = maskAccount(account.login)
    switch (outcome) {
      case 'accepted':
        account.unresolved.delete(deal.dealTicket)
        account.dealsAccepted += 1
        this.counters.dealsAccepted += 1
        if (sync !== null) sync.accepted += 1
        this.emit({ kind: 'deal_accepted', account: masked })
        return
      case 'duplicate':
        account.unresolved.delete(deal.dealTicket)
        account.duplicatesIgnored += 1
        this.counters.duplicatesIgnored += 1
        if (sync !== null) sync.duplicates += 1
        this.emit({ kind: 'duplicate_ignored', account: masked })
        return
      case 'conflict':
        this.emit({ kind: 'deal_conflict', account: masked })
        return
      case 'capacity':
        this.counters.capacityRejected += 1
        this.rejectFrame(connection, 'staging capacity reached')
        return
    }
  }

  private dropConnection(connection: Connection, reason: string): void {
    if (connection.closed) return
    connection.closed = true
    connection.pending = Buffer.alloc(0)
    this.emit({ kind: 'dropped', connectionId: connection.id, reason })
    connection.socket.destroy()
    // 'close' fires asynchronously; do the bookkeeping now so state is
    // consistent immediately and stays correct if 'close' is delayed.
    this.finishConnection(connection)
  }

  private onClosed(connection: Connection): void {
    connection.closed = true
    this.finishConnection(connection)
  }

  private finished = new WeakSet<Connection>()

  private finishConnection(connection: Connection): void {
    if (this.finished.has(connection)) return
    this.finished.add(connection)
    this.connections.delete(connection)
    this.counters.connectionsClosed += 1
    if (connection.sync !== null && connection.sync.status === 'in_progress') connection.sync.status = 'aborted'
    connection.sync = null
    const account = connection.account
    if (account !== null) account.activeConnections = Math.max(0, account.activeConnections - 1)
    this.emit({
      kind: 'disconnected',
      connectionId: connection.id,
      account: account === null ? null : maskAccount(account.login)
    })
  }

  private toAccountStatus(a: AccountRecord): Mt5AccountStatus {
    return {
      server: a.server,
      login: a.login,
      company: a.company,
      currency: a.currency,
      marginMode: a.marginMode,
      positionAccounting: positionAccountingOf(a.marginMode),
      tradeMode: a.tradeMode,
      hedgeCapable: a.hedgeCapable,
      eaVersion: a.eaVersion,
      terminalBuild: a.terminalBuild,
      connected: a.activeConnections > 0,
      lastHelloAt: a.lastHelloAt,
      lastHeartbeatAt: a.lastHeartbeatAt,
      lastSync: a.lastSync === null ? null : { ...a.lastSync },
      dealsAccepted: a.dealsAccepted,
      duplicatesIgnored: a.duplicatesIgnored,
      unresolvedDealTickets: [...a.unresolved]
    }
  }
}
