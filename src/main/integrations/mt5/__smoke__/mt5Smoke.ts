/**
 * MT5 bridge smoke suite. Needs no MetaTrader and no real account: a fake EA
 * speaks the wire protocol to a real loopback receiver.
 * Run with: npm run smoke:mt5
 */
import { readFileSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { resolve } from 'node:path'
import { decimalToScaled } from '../../../persistence/fixedPoint'
import { canonicalizeDecimal, dealEntryLabel, dealTypeLabel } from '../protocol'
import { describeBridgeEvent } from '../index'
import { Mt5Receiver, type Mt5BridgeEvent, type Mt5ReceiverOptions } from '../receiver'
import { rawDealIdentity } from '../rawDealStaging'
import {
  COSTS,
  HEDGING,
  NETTING_REVERSAL,
  RESTART_GAP,
  SCALE_IN_PARTIAL_OUT,
  SIMPLE_LONG,
  SIMPLE_SHORT
} from './fixtures'
import { DEMO_HEDGING, DEMO_NETTING, FakeEa, dealFrame, helloFrame, type DealSpec } from './fakeEa'

let passed = 0
let failed = 0
const lines: string[] = []

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body()
    passed += 1
    lines.push(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    lines.push(`FAIL  ${name}\n        ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function settle(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

interface Harness {
  receiver: Mt5Receiver
  port: number
  events: Mt5BridgeEvent[]
}

async function withReceiver(options: Mt5ReceiverOptions, body: (h: Harness) => Promise<void>): Promise<void> {
  const events: Mt5BridgeEvent[] = []
  const receiver = new Mt5Receiver({ port: 0, ...options, onEvent: (e) => events.push(e) })
  const port = await receiver.start()
  try {
    await body({ receiver, port, events })
  } finally {
    await receiver.stop()
  }
}

async function connectEa(h: Harness, account = DEMO_NETTING): Promise<FakeEa> {
  const helloCount = (): number => h.events.filter((e) => e.kind === 'hello').length
  const before = helloCount()
  const ea = new FakeEa(h.port)
  await ea.connect()
  ea.hello(account)
  // Frames are processed asynchronously; wait until the hello is fully handled.
  await waitFor(() => helloCount() > before || ea.isClosed, 'hello processed')
  return ea
}

function staged(h: Harness) {
  return h.receiver.getStagedDeals()
}

function byPosition(h: Harness, positionId: string) {
  return staged(h)
    .filter((s) => s.deal.positionId === positionId)
    .sort((a, b) => a.deal.timeMsc - b.deal.timeMsc)
}

async function sendAndWait(h: Harness, ea: FakeEa, account: typeof DEMO_NETTING, specs: readonly DealSpec[]): Promise<void> {
  const before = h.receiver.getStatus().stats.framesReceived
  for (const spec of specs) ea.deal(account, spec)
  await waitFor(() => h.receiver.getStatus().stats.framesReceived >= before + specs.length, 'frames processed')
}

const EXPECTED_DEAL_KEYS = [
  'source', 'protocolVersion', 'server', 'accountLogin', 'dealTicket', 'orderTicket', 'positionId', 'externalId',
  'timeMsc', 'symbol', 'dealType', 'dealEntry', 'volume', 'price', 'profit', 'commission', 'fee', 'swap', 'magic', 'reason'
]

async function main(): Promise<void> {
  // ------------------------------------------------------------------ lifecycle
  await check('listener starts on loopback only and stops cleanly (idempotent)', async () => {
    const receiver = new Mt5Receiver({ port: 0 })
    const port = await receiver.start()
    const status = receiver.getStatus()
    assert(status.listening, 'should be listening')
    equal(status.address, { host: '127.0.0.1', port }, 'bound address')
    await receiver.stop()
    await receiver.stop()
    assert(!receiver.getStatus().listening, 'should be stopped')
    // the port is free again
    const again = new Mt5Receiver({ port })
    await again.start()
    await again.stop()
  })

  await check('non-loopback host is refused at construction', () => {
    let threw = false
    try {
      new Mt5Receiver({ host: '0.0.0.0' as unknown as '127.0.0.1' })
    } catch {
      threw = true
    }
    assert(threw, 'binding 0.0.0.0 must throw')
  })

  await check('port already in use: start rejects, nothing crashes', async () => {
    const blocker = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const busyPort = (blocker.address() as { port: number }).port
    const events: Mt5BridgeEvent[] = []
    const receiver = new Mt5Receiver({ port: busyPort, onEvent: (e) => events.push(e) })
    let rejected = false
    try {
      await receiver.start()
    } catch {
      rejected = true
    }
    await new Promise<void>((r) => blocker.close(() => r()))
    assert(rejected, 'start should reject')
    assert(events.some((e) => e.kind === 'listen_error'), 'listen_error event expected')
    assert(!receiver.getStatus().listening, 'not listening')
  })

  // ------------------------------------------------------------------ hello
  await check('account hello validates; accounting mode + metadata captured', async () => {
    await withReceiver({}, async (h) => {
      const a = await connectEa(h, DEMO_NETTING)
      const b = await connectEa(h, DEMO_HEDGING)
      await waitFor(() => h.receiver.getStatus().accounts.length === 2, 'two accounts')
      const accounts = h.receiver.getStatus().accounts
      const net = accounts.find((x) => x.login === DEMO_NETTING.login)
      const hedge = accounts.find((x) => x.login === DEMO_HEDGING.login)
      assert(net !== undefined && hedge !== undefined, 'accounts present')
      equal(net.positionAccounting, 'RETAIL_NETTING', 'netting mode')
      equal(hedge.positionAccounting, 'RETAIL_HEDGING', 'hedging mode')
      equal(hedge.hedgeCapable, true, 'hedge capable')
      equal([net.currency, net.server, net.eaVersion, net.terminalBuild, net.connected], ['USD', 'Demo-Server', '1.0.0-test', 5000, true], 'metadata')
      assert(!JSON.stringify(h.receiver.getStatus()).includes('bridgeKey'), 'status must not expose a bridge key')
      await a.close()
      await b.close()
    })
  })

  await check('EXCHANGE margin mode is recognised', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h, { login: '1000003', server: 'Demo-Server', marginMode: 1 })
      await waitFor(() => h.receiver.getStatus().accounts.length === 1, 'account')
      equal(h.receiver.getStatus().accounts[0]?.positionAccounting, 'EXCHANGE', 'exchange mode')
      await ea.close()
    })
  })

  // ------------------------------------------------------------------ raw lifecycles
  await check('CASE 1 simple LONG: BUY IN / SELL OUT raw facts preserved, no direction derived', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      await sendAndWait(h, ea, DEMO_NETTING, SIMPLE_LONG)
      const deals = byPosition(h, '7001')
      equal(deals.length, 2, 'two deals')
      equal(deals.map((d) => [dealTypeLabel(d.deal.dealType), dealEntryLabel(d.deal.dealEntry)]), [['BUY', 'IN'], ['SELL', 'OUT']], 'raw sides')
      equal(Object.keys(deals[0]!.deal), EXPECTED_DEAL_KEYS, 'no derived fields on a raw deal')
      equal([deals[0]!.deal.price, deals[0]!.deal.volume, deals[0]!.deal.orderTicket, deals[0]!.deal.magic], ['1.085', '1', '8001', '11'], 'first deal facts')
      equal(deals[1]!.deal.profit, '150', 'exit profit')
      await ea.close()
    })
  })

  await check('CASE 2 simple SHORT: SELL IN / BUY OUT raw facts preserved (closing BUY not treated as LONG)', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      await sendAndWait(h, ea, DEMO_NETTING, SIMPLE_SHORT)
      const deals = byPosition(h, '7101')
      equal(deals.map((d) => [dealTypeLabel(d.deal.dealType), dealEntryLabel(d.deal.dealEntry)]), [['SELL', 'IN'], ['BUY', 'OUT']], 'raw sides')
      await ea.close()
    })
  })

  await check('CASE 3 scale-in / partial-out: four deals retained on one source position', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      await sendAndWait(h, ea, DEMO_NETTING, SCALE_IN_PARTIAL_OUT)
      const deals = byPosition(h, '7201')
      equal(deals.length, 4, 'four deals')
      equal(deals.map((d) => d.deal.dealTicket), ['9201', '9202', '9203', '9204'], 'tickets by time')
      equal(deals.map((d) => dealEntryLabel(d.deal.dealEntry)), ['IN', 'IN', 'OUT', 'OUT'], 'entries')
      await ea.close()
    })
  })

  await check('CASE 4 hedging: independent same-symbol position ids preserved, interleaved', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h, DEMO_HEDGING)
      await sendAndWait(h, ea, DEMO_HEDGING, HEDGING)
      equal(staged(h).length, 5, 'five deals')
      equal(byPosition(h, '7301').map((d) => d.deal.dealTicket), ['9301', '9303'], 'position 7301')
      equal(byPosition(h, '7302').map((d) => d.deal.dealTicket), ['9302', '9305'], 'position 7302')
      equal(byPosition(h, '7303').map((d) => d.deal.dealTicket), ['9304'], 'position 7303')
      equal(new Set(staged(h).map((d) => d.deal.symbol)).size, 1, 'all one symbol')
      // simultaneous opposite directions on the same symbol survive as raw facts
      equal(dealTypeLabel(byPosition(h, '7301')[0]!.deal.dealType), 'BUY', '7301 opens BUY')
      equal(dealTypeLabel(byPosition(h, '7302')[0]!.deal.dealType), 'SELL', '7302 opens SELL')
      await ea.close()
    })
  })

  await check('CASE 5 netting reversal: INOUT deal kept raw, no premature segmentation', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      await sendAndWait(h, ea, DEMO_NETTING, NETTING_REVERSAL)
      const deals = byPosition(h, '7401')
      equal(deals.length, 2, 'two raw deals')
      equal(dealEntryLabel(deals[1]!.deal.dealEntry), 'INOUT', 'reversal entry preserved')
      equal(deals[1]!.deal.volume, '2', 'reversal volume preserved (not split)')
      await ea.close()
    })
  })

  // ------------------------------------------------------------------ dedup / order / restart
  await check('CASE 6 duplicate replay: same deal live twice + history replay -> one identity', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      await sendAndWait(h, ea, DEMO_NETTING, [SIMPLE_LONG[0]!, SIMPLE_LONG[0]!])
      equal(staged(h).length, 1, 'one staged after live duplicate')
      ea.historySync(DEMO_NETTING, 'sync-1', SIMPLE_LONG)
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.status === 'complete', 'sync complete')
      equal(staged(h).length, 2, 'two unique identities')
      const sync = h.receiver.getStatus().accounts[0]!.lastSync!
      equal([sync.accepted, sync.duplicates], [1, 1], 'history: one new, one duplicate')
      equal(h.receiver.getStatus().stats.duplicatesIgnored, 2, 'duplicates counted')
      await ea.close()
    })
  })

  await check('CASE 6b identity is source+server+login+ticket (same ticket, other account = distinct)', async () => {
    await withReceiver({}, async (h) => {
      const a = await connectEa(h, DEMO_NETTING)
      const b = await connectEa(h, DEMO_HEDGING)
      await sendAndWait(h, a, DEMO_NETTING, [SIMPLE_LONG[0]!])
      await sendAndWait(h, b, DEMO_HEDGING, [SIMPLE_LONG[0]!])
      equal(staged(h).length, 2, 'distinct per account')
      assert(rawDealIdentity(staged(h)[0]!.deal) !== rawDealIdentity(staged(h)[1]!.deal), 'identities differ')
      await a.close()
      await b.close()
    })
  })

  await check('CASE 6c conflicting replay keeps first-seen record and is flagged', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      await sendAndWait(h, ea, DEMO_NETTING, [SIMPLE_LONG[0]!, { ...SIMPLE_LONG[0]!, price: '9.99999' }])
      equal(staged(h).length, 1, 'still one')
      equal(staged(h)[0]!.deal.price, '1.085', 'first-seen kept')
      equal(h.receiver.getStatus().stats.conflicts, 1, 'conflict counted')
      await ea.close()
    })
  })

  await check('CASE 7 out-of-order arrival: facts intact, arrival order not assumed', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      await sendAndWait(h, ea, DEMO_NETTING, [...SCALE_IN_PARTIAL_OUT].reverse())
      const arrival = staged(h)
      equal(arrival.map((d) => d.deal.dealTicket), ['9204', '9203', '9202', '9201'], 'arrival order recorded as received')
      equal(arrival.map((d) => d.arrivalSeq), [1, 2, 3, 4], 'arrival sequence')
      equal(byPosition(h, '7201').map((d) => d.deal.dealTicket), ['9201', '9202', '9203', '9204'], 'time view reconstructible from timeMsc')
      await ea.close()
    })
  })

  await check('CASE 8 restart gap: known deals dedupe, missing deals accepted', async () => {
    await withReceiver({}, async (h) => {
      const first = await connectEa(h)
      await sendAndWait(h, first, DEMO_NETTING, RESTART_GAP.slice(0, 2))
      await first.close()
      await waitFor(() => !h.receiver.getStatus().accounts[0]!.connected, 'first EA gone')
      // "Solid Skill was closed while 9603/9604 happened": EA reconnects and replays history.
      const second = await connectEa(h)
      second.historySync(DEMO_NETTING, 'sync-restart', RESTART_GAP)
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.status === 'complete', 'restart sync complete')
      equal(staged(h).map((d) => d.deal.dealTicket).sort(), ['9601', '9602', '9603', '9604'], 'all four present')
      const sync = h.receiver.getStatus().accounts[0]!.lastSync!
      equal([sync.received, sync.accepted, sync.duplicates], [4, 2, 2], 'sync accounting')
      await second.close()
    })
  })

  await check('history_end count mismatch is reported incomplete; dropped mid-sync is aborted', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      ea.historySync(DEMO_NETTING, 'sync-short', SIMPLE_LONG, { discovered: 5, sent: 5, failed: 0 })
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.status === 'incomplete', 'incomplete')
      ea.send({ v: 1, type: 'history_begin', syncId: 'sync-cut' })
      ea.send(dealFrame(DEMO_NETTING, SIMPLE_SHORT[0]!, 'history', 'sync-cut'))
      await waitFor(() => staged(h).length === 3, 'mid-sync deal staged')
      ea.destroy()
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.status === 'aborted', 'aborted')
    })
  })

  await check('REGRESSION checkpoint 012: 1 of 40 deals readable is INCOMPLETE, never a clean "1/1" complete', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      // What the real terminal produced when HistoryDealSelect collapsed the list:
      // MT5 listed 40 deals, the EA could send only the first one.
      ea.historySync(DEMO_NETTING, 'sync-collapsed', [SIMPLE_LONG[0]!], { discovered: 40, sent: 1, failed: 39 })
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.status === 'incomplete', 'incomplete reported')
      const sync = h.receiver.getStatus().accounts[0]!.lastSync!
      equal([sync.discovered, sync.sent, sync.failed, sync.received], [40, 1, 39, 1], 'sync counts kept distinct')
      const end = h.events.find((e) => e.kind === 'history_end')
      assert(end !== undefined && end.kind === 'history_end', 'history_end event')
      equal(end.status, 'incomplete', 'event status')
      const line = describeBridgeEvent(end) ?? ''
      assert(line.includes('INCOMPLETE') && line.includes('discovered 40') && line.includes('failed 39'), `truthful log line: ${line}`)
      assert(!/received 1\/1/.test(line), 'must not read like a clean 1/1')
      await ea.close()
    })
  })

  await check('history_end status: complete only when nothing failed and sent == discovered == received', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      ea.historySync(DEMO_NETTING, 'ok-1', SIMPLE_LONG)
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.status === 'complete', 'complete')
      // EA claims sent == discovered but one frame never arrived
      ea.historySync(DEMO_NETTING, 'lost-1', SIMPLE_SHORT, { discovered: 3, sent: 3, failed: 0 })
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.syncId === 'lost-1' && h.receiver.getStatus().accounts[0]?.lastSync?.status !== 'in_progress', 'lost sync closed')
      equal(h.receiver.getStatus().accounts[0]!.lastSync!.status, 'incomplete', 'transport loss detected')
      // EA reports failures even though everything it sent arrived
      ea.historySync(DEMO_NETTING, 'partial-1', COSTS, { discovered: COSTS.length + 2, sent: COSTS.length, failed: 2 })
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.syncId === 'partial-1' && h.receiver.getStatus().accounts[0]?.lastSync?.status !== 'in_progress', 'partial sync closed')
      equal(h.receiver.getStatus().accounts[0]!.lastSync!.status, 'incomplete', 'EA-side failures make it incomplete')
      // an empty window is a legitimate complete sync
      ea.historySync(DEMO_NETTING, 'empty-1', [])
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.syncId === 'empty-1' && h.receiver.getStatus().accounts[0]?.lastSync?.status !== 'in_progress', 'empty sync closed')
      equal(h.receiver.getStatus().accounts[0]!.lastSync!.status, 'complete', 'empty history is complete')
      await ea.close()
    })
  })

  await check('history_end with inconsistent or legacy counts is rejected', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      ea.send({ v: 1, type: 'history_begin', syncId: 'bad-counts' })
      ea.send({ v: 1, type: 'history_end', syncId: 'bad-counts', discovered: 1, sent: 2, failed: 0 })
      ea.send({ v: 1, type: 'history_end', syncId: 'bad-counts', dealCount: 1 })
      await waitFor(() => h.receiver.getStatus().stats.framesRejected === 2, 'both rejected')
      equal(h.receiver.getStatus().accounts[0]!.lastSync!.status, 'in_progress', 'sync not closed by bad frames')
      await ea.close()
    })
  })

  await check('EA error diagnostics (stage / index / ticket / lastError) are parsed and logged without secrets', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      ea.send({ v: 1, type: 'error', code: 'DEAL_FETCH_FAILED', dealTicket: '9001', detail: 'x', stage: 'DEAL_ORDER', index: 7, lastError: 4753 })
      ea.send({ v: 1, type: 'error', code: 'DEAL_FETCH_FAILED', dealTicket: null, detail: 'x', stage: 'HistoryDealGetTicket', index: 1, lastError: 0 })
      ea.send({ v: 1, type: 'error', code: 'DEAL_FETCH_FAILED', dealTicket: null, detail: 'legacy frame without diagnostics' })
      await waitFor(() => h.events.filter((e) => e.kind === 'ea_error').length === 3, 'three ea_error events')
      const lines = h.events.map(describeBridgeEvent).filter((l): l is string => l !== null && l.includes('EA reported'))
      assert(lines[0]!.includes('stage=DEAL_ORDER') && lines[0]!.includes('index=7') && lines[0]!.includes('ticket=9001') && lines[0]!.includes('lastError=4753'), `diagnostic line: ${lines[0]}`)
      assert(!lines[0]!.includes(DEMO_NETTING.login), 'login masked')
      equal(h.receiver.getStatus().stats.framesRejected, 0, 'diagnostic frames are valid')
      await ea.close()
    })
  })

  await check('EA-reported deal fetch failure is tracked, then cleared when the deal arrives', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      ea.send({ v: 1, type: 'error', code: 'DEAL_FETCH_FAILED', dealTicket: '9001', detail: 'not in history yet' })
      await waitFor(() => (h.receiver.getStatus().accounts[0]?.unresolvedDealTickets.length ?? 0) === 1, 'unresolved tracked')
      await sendAndWait(h, ea, DEMO_NETTING, [SIMPLE_LONG[0]!])
      equal(h.receiver.getStatus().accounts[0]!.unresolvedDealTickets, [], 'cleared')
      await ea.close()
    })
  })

  // ------------------------------------------------------------------ costs
  await check('CASE 9 commission/fee/swap stay distinct; null (unreported) differs from zero', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      await sendAndWait(h, ea, DEMO_NETTING, COSTS)
      const [entry, exit] = byPosition(h, '7501')
      equal([entry!.deal.commission, entry!.deal.fee, entry!.deal.swap, entry!.deal.profit], ['-3.5', '-0.25', '-1.2', '0'], 'entry costs')
      equal([exit!.deal.commission, exit!.deal.fee, exit!.deal.swap], [null, '0', null], 'null vs zero')
      await ea.close()
    })
  })

  // ------------------------------------------------------------------ malformed / oversized
  await check('CASE 10 malformed frames are rejected safely; connection and receiver survive', async () => {
    await withReceiver({ maxRejectsPerConnection: 100 }, async (h) => {
      const ea = await connectEa(h)
      const good = dealFrame(DEMO_NETTING, SIMPLE_LONG[0]!)
      const bad: string[] = [
        'not json at all',
        '[]',
        '"string"',
        'null',
        '{"v":2,"type":"deal"}',
        '{"v":1,"type":"launch_missiles"}',
        '{"v":1,"type":"deal"}',
        JSON.stringify({ ...good, volume: 1 }), // JSON number instead of decimal string
        JSON.stringify({ ...good, volume: '1e3' }),
        JSON.stringify({ ...good, price: 'NaN' }),
        JSON.stringify({ ...good, price: '1,085' }),
        JSON.stringify({ ...good, price: '0.123456789' }),
        JSON.stringify({ ...good, volume: '-1' }),
        JSON.stringify({ ...good, commission: 0 }),
        JSON.stringify({ ...good, dealTicket: '0' }),
        JSON.stringify({ ...good, dealTicket: '-5' }),
        JSON.stringify({ ...good, dealTicket: '99999999999999999999999' }),
        JSON.stringify({ ...good, dealTicket: 123 }),
        JSON.stringify({ ...good, timeMsc: 1.5 }),
        JSON.stringify({ ...good, timeMsc: '1760000000000' }),
        JSON.stringify({ ...good, dealType: 999 }),
        JSON.stringify({ ...good, symbol: 'EUR\u0000USD' }),
        JSON.stringify({ ...good, origin: 'history' }), // history without syncId
        JSON.stringify({ ...good, origin: 'history', syncId: 'never-began' }), // no active sync
        JSON.stringify({ ...good, accountLogin: '5555555' }), // not the hello account
        JSON.stringify({ ...good, server: 'Other-Server' }),
        JSON.stringify({ ...good, source: 'TRADOVATE' }),
        (() => {
          const { profit: _profit, ...rest } = good
          void _profit
          return JSON.stringify(rest)
        })(), // nullable fields must be stated explicitly
        JSON.stringify(helloFrame(DEMO_NETTING)) // second hello
      ]
      for (const frame of bad) ea.sendRaw(`${frame}\n`)
      await waitFor(() => h.receiver.getStatus().stats.framesReceived >= bad.length, 'all bad frames processed')
      equal(staged(h).length, 0, 'nothing staged from bad frames')
      equal(h.receiver.getStatus().stats.framesRejected, bad.length, 'every bad frame rejected')
      assert(!ea.isClosed, 'connection tolerated invalid post-hello frames')
      await sendAndWait(h, ea, DEMO_NETTING, [SIMPLE_LONG[0]!])
      equal(staged(h).length, 1, 'valid deal still accepted afterwards')
      await ea.close()
    })
  })

  await check('malformed BEFORE hello drops the peer; receiver keeps serving others', async () => {
    await withReceiver({}, async (h) => {
      const rogue = new FakeEa(h.port)
      await rogue.connect()
      rogue.sendRaw('garbage\n')
      await waitFor(() => rogue.isClosed, 'rogue dropped')
      const deal = new FakeEa(h.port)
      await deal.connect()
      deal.send(dealFrame(DEMO_NETTING, SIMPLE_LONG[0]!)) // deal before hello
      await waitFor(() => deal.isClosed, 'pre-hello deal dropped')
      const binary = new FakeEa(h.port)
      await binary.connect()
      binary.sendRaw(Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x0a]))
      await waitFor(() => binary.isClosed, 'binary garbage dropped')
      equal(staged(h).length, 0, 'nothing staged')
      const ok = await connectEa(h)
      await sendAndWait(h, ok, DEMO_NETTING, [SIMPLE_LONG[0]!])
      equal(staged(h).length, 1, 'healthy client unaffected')
      await ok.close()
    })
  })

  await check('too many invalid frames on one connection drops it', async () => {
    await withReceiver({ maxRejectsPerConnection: 3 }, async (h) => {
      const ea = await connectEa(h)
      for (let i = 0; i < 4; i++) ea.sendRaw('bad\n')
      await waitFor(() => ea.isClosed, 'dropped after threshold')
    })
  })

  await check('oversized frames rejected (with and without newline); receiver survives', async () => {
    await withReceiver({ maxFrameBytes: 1024 }, async (h) => {
      const withNewline = await connectEa(h)
      withNewline.sendRaw(`${'x'.repeat(5000)}\n`)
      await waitFor(() => withNewline.isClosed, 'oversized line dropped')
      const noNewline = await connectEa(h)
      noNewline.sendRaw('y'.repeat(5000))
      await waitFor(() => noNewline.isClosed, 'unterminated flood dropped')
      const ok = await connectEa(h)
      await sendAndWait(h, ok, DEMO_NETTING, [SIMPLE_LONG[0]!])
      equal(staged(h).length, 1, 'healthy client unaffected')
      await ok.close()
    })
  })

  await check('frames split across TCP chunks and several frames per chunk are framed correctly', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      const a = `${JSON.stringify(dealFrame(DEMO_NETTING, SIMPLE_LONG[0]!))}\n`
      const b = `${JSON.stringify(dealFrame(DEMO_NETTING, SIMPLE_LONG[1]!))}\r\n`
      const all = a + b
      ea.sendRaw(all.slice(0, 40))
      await settle(30)
      ea.sendRaw(all.slice(40, a.length + 10))
      await settle(30)
      ea.sendRaw(all.slice(a.length + 10))
      await waitFor(() => staged(h).length === 2, 'both frames reassembled')
      await ea.close()
    })
  })

  // ------------------------------------------------------------------ connection behaviour
  await check('disconnect / reconnect is safe and state stays consistent', async () => {
    await withReceiver({}, async (h) => {
      const first = await connectEa(h)
      await sendAndWait(h, first, DEMO_NETTING, [SIMPLE_LONG[0]!])
      first.destroy() // abrupt: no FIN handshake courtesy
      await waitFor(() => !h.receiver.getStatus().accounts[0]!.connected, 'marked disconnected')
      equal(h.receiver.getStatus().connections, 0, 'no live connections')
      const second = await connectEa(h)
      await waitFor(() => h.receiver.getStatus().accounts[0]!.connected, 'marked connected again')
      await sendAndWait(h, second, DEMO_NETTING, [SIMPLE_LONG[1]!])
      equal(staged(h).length, 2, 'both deals present')
      equal(h.receiver.getStatus().accounts.length, 1, 'still one account record')
      await second.close()
    })
  })

  await check('stop() while clients are connected closes them and does not throw', async () => {
    const receiver = new Mt5Receiver({ port: 0 })
    const port = await receiver.start()
    const ea = new FakeEa(port)
    await ea.connect()
    ea.hello(DEMO_NETTING)
    await waitFor(() => receiver.getStatus().accounts.length === 1, 'hello')
    await receiver.stop()
    await waitFor(() => ea.isClosed, 'client closed by stop()')
  })

  await check('handshake timeout drops a silent peer', async () => {
    await withReceiver({ handshakeTimeoutMs: 80 }, async (h) => {
      const silent = new FakeEa(h.port)
      await silent.connect()
      await waitFor(() => silent.isClosed, 'silent peer dropped')
    })
  })

  await check('connection limit is enforced', async () => {
    await withReceiver({ maxConnections: 1 }, async (h) => {
      const first = await connectEa(h)
      await waitFor(() => h.receiver.getStatus().connections === 1, 'first connected')
      const second = new FakeEa(h.port)
      await second.connect()
      await waitFor(() => second.isClosed, 'second refused')
      equal(h.receiver.getStatus().stats.connectionsRefused, 1, 'refusal counted')
      await first.close()
    })
  })

  await check('bridge key: correct key accepted, missing/wrong key dropped', async () => {
    await withReceiver({ bridgeKey: 'pairing-key-1' }, async (h) => {
      const missing = new FakeEa(h.port)
      await missing.connect()
      missing.hello(DEMO_NETTING)
      await waitFor(() => missing.isClosed, 'missing key dropped')
      const wrong = new FakeEa(h.port)
      await wrong.connect()
      wrong.hello(DEMO_NETTING, { bridgeKey: 'nope' })
      await waitFor(() => wrong.isClosed, 'wrong key dropped')
      equal(h.receiver.getStatus().accounts.length, 0, 'no account registered by rejected peers')
      const ok = new FakeEa(h.port)
      await ok.connect()
      ok.hello(DEMO_NETTING, { bridgeKey: 'pairing-key-1' })
      await waitFor(() => h.receiver.getStatus().accounts.length === 1, 'right key accepted')
      const logged = JSON.stringify(h.events)
      assert(!logged.includes('pairing-key-1') && !logged.includes('nope'), 'keys never appear in events')
      await ok.close()
    })
  })

  await check('diagnostic events mask account logins and carry no prices', async () => {
    await withReceiver({}, async (h) => {
      const ea = await connectEa(h)
      ea.historySync(DEMO_NETTING, 'sync-diag', SIMPLE_LONG)
      await waitFor(() => h.receiver.getStatus().accounts[0]?.lastSync?.status === 'complete', 'sync')
      const text = JSON.stringify(h.events)
      assert(!text.includes(DEMO_NETTING.login), 'full login must not be in events')
      assert(text.includes('***001'), 'masked login present')
      assert(!text.includes('1.085'), 'no price data in events')
      for (const kind of ['listening', 'connected', 'hello', 'history_begin', 'history_end', 'deal_accepted']) {
        assert(h.events.some((e) => e.kind === kind), `event ${kind} emitted`)
      }
      await ea.close()
      await waitFor(() => h.events.some((e) => e.kind === 'disconnected'), 'disconnected event')
    })
  })

  await check('listener is bound to 127.0.0.1 and accepts a loopback client', async () => {
    await withReceiver({}, async (h) => {
      const address = h.receiver.getStatus().address
      equal(address?.host, '127.0.0.1', 'host')
      await new Promise<void>((resolveConn, rejectConn) => {
        const s = connect({ host: '127.0.0.1', port: h.port }, () => {
          s.destroy()
          resolveConn()
        })
        s.on('error', rejectConn)
      })
    })
  })

  // ------------------------------------------------------------------ contract cross-checks
  await check('decimal validation agrees with persistence fixed-point codec', () => {
    const samples = [
      '0', '1', '-1.5', '+2', '00.50', '1.23456789', '1.234567891', '1.100000000', '1e5', '', '.5', '5.', 'abc', ' 1',
      '1 ', '--1', '92233720368.54775807', '92233720368.54775808', '-0', '0.0', '123456789012345678901234567890'
    ]
    for (const sample of samples) {
      const canonical = canonicalizeDecimal(sample)
      let scaled: bigint | null
      try {
        scaled = decimalToScaled(sample)
      } catch {
        scaled = null
      }
      // The codec trims whitespace; the wire contract deliberately does not.
      if (sample !== sample.trim()) {
        assert(canonical === null, `wire contract must reject whitespace: ${JSON.stringify(sample)}`)
        continue
      }
      if (scaled === null) {
        assert(canonical === null, `wire accepted what the codec rejects: ${JSON.stringify(sample)}`)
      } else {
        assert(canonical !== null, `wire rejected what the codec accepts: ${JSON.stringify(sample)}`)
        assert(decimalToScaled(canonical) === scaled, `canonical form preserves value: ${JSON.stringify(sample)}`)
      }
    }
  })

  await check('EA source is read-only: no trading API, no includes, no DLL imports, loopback guard present', () => {
    const source = readFileSync(resolve('integrations/mt5/ea/SolidSkillBridge.mq5'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const forbidden: Array<[string, RegExp]> = [
      ['OrderSend', /\bOrderSend(Async)?\b/],
      ['OrderCheck / OrderCalc', /\bOrder(Check|Calc\w*)\b/],
      ['CTrade', /\bCTrade\b/],
      ['CPositionInfo / COrderInfo trade helpers', /\b(CPositionInfo|COrderInfo|CDealInfo)\b/],
      ['#include', /^\s*#include\b/m],
      ['#import (DLL)', /^\s*#import\b/m],
      ['TRADE_ACTION_*', /\bTRADE_ACTION_\w+/],
      ['Trade.mqh', /Trade\.mqh/i],
      ['PositionClose / PositionModify', /\bPosition(Close|Modify|Open)\w*\b/],
      ['SocketRead (EA must never read commands)', /\bSocketRead\b/],
      ['WebRequest', /\bWebRequest\b/],
      ['ShellExecute / file writes', /\b(ShellExecute\w*|FileOpen|FileWrite\w*)\b/]
    ]
    for (const [name, pattern] of forbidden) assert(!pattern.test(code), `EA source contains forbidden construct: ${name}`)
    assert(/InpHost\s*!=\s*"127\.0\.0\.1"/.test(code), 'EA must enforce a loopback host')
    for (const required of ['OnInit', 'OnDeinit', 'OnTradeTransaction', 'OnTimer', 'TRADE_TRANSACTION_DEAL_ADD', 'HistorySelect', 'DEAL_POSITION_ID', 'DEAL_TIME_MSC']) {
      assert(code.includes(required), `EA missing expected element: ${required}`)
    }
  })

  await check('REGRESSION: EA history loop never calls HistoryDealSelect (it would collapse the HistorySelect list)', () => {
    const source = readFileSync(resolve('integrations/mt5/ea/SolidSkillBridge.mq5'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const functionBody = (name: string): string => {
      const start = code.search(new RegExp(`^[A-Za-z_][\\w<>\\s]*\\b${name}\\s*\\(`, 'm'))
      assert(start >= 0, `function ${name} not found`)
      const open = code.indexOf('{', start)
      let depth = 0
      for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth += 1
        else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1)
      }
      throw new Error(`unterminated function ${name}`)
    }
    // Everything reachable from the history loop must be select-free.
    for (const name of ['SyncHistory', 'SendDealProperties', 'ReadInt', 'ReadDouble', 'ReportHistoryFailure']) {
      assert(!/HistoryDealSelect/.test(functionBody(name)), `${name} must not call HistoryDealSelect`)
    }
    const history = functionBody('SyncHistory')
    assert(/HistoryDealsTotal\s*\(/.test(history) && /HistoryDealGetTicket\s*\(\s*i\s*\)/.test(history), 'history loop iterates by original index')
    assert(!/SendLiveDeal/.test(history), 'history loop must not use the live selection path')
    // The only selection call in the program is the explicit live path.
    equal((code.match(/HistoryDealSelect\s*\(/g) ?? []).length, 1, 'exactly one HistoryDealSelect in the EA')
    assert(/HistoryDealSelect\s*\(/.test(functionBody('SendLiveDeal')), 'the selection lives in SendLiveDeal')
    // history_end must report all three counts, not just what was sent.
    assert(/\\"discovered\\"/.test(history) && /\\"sent\\"/.test(history) && /\\"failed\\"/.test(history), 'history_end carries discovered/sent/failed')
  })

  await check('receiver source never writes to peers or executes anything', () => {
    const src = readFileSync(resolve('src/main/integrations/mt5/receiver.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert(!/socket\.(write|end)\(/.test(src), 'receiver must not write to sockets')
    assert(!/child_process|\bexec\w*\(|\bspawn\w*\(|node:fs|readFile|writeFile/.test(src), 'receiver must not run commands or touch files')
  })

  process.stdout.write(`${lines.join('\n')}\n\nMT5 smoke: ${passed} passed, ${failed} failed\n`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((error) => {
  process.stdout.write(`${lines.join('\n')}\n\nMT5 smoke crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})
