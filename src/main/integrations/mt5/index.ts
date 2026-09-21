import { DEFAULT_MT5_BRIDGE_PORT } from './protocol'
import { Mt5Receiver, type Mt5BridgeEvent } from './receiver'

export * from './protocol'
export * from './rawDealStaging'
export * from './receiver'

/**
 * Compact, non-sensitive log line for a bridge event. Per-deal events are
 * deliberately not logged (they would spam and add nothing); sync summaries,
 * connections, and failures are.
 */
export function describeBridgeEvent(event: Mt5BridgeEvent): string | null {
  switch (event.kind) {
    case 'listening':
      return `MT5 bridge listening on ${event.host}:${event.port}`
    case 'stopped':
      return 'MT5 bridge stopped'
    case 'listen_error':
      return `MT5 bridge listener error: ${event.message}`
    case 'hello':
      return `MT5 account hello received (${event.account}, ${event.accounting ?? 'unknown accounting mode'})`
    case 'history_begin':
      return `MT5 history sync started (${event.account})`
    case 'history_end':
      return (
        `MT5 history sync ${event.status.toUpperCase()} (${event.account}): discovered ${event.discovered}, ` +
        `EA sent ${event.sent}, EA failed ${event.failed}, received ${event.received}; ` +
        `${event.accepted} new, ${event.duplicates} already known`
      )
    case 'ea_error':
      return (
        `MT5 EA reported ${event.code} (${event.account})` +
        `${event.stage === null ? '' : ` stage=${event.stage}`}` +
        `${event.index === null ? '' : ` index=${event.index}`}` +
        `${event.dealTicket === null ? '' : ` ticket=${event.dealTicket}`}` +
        `${event.lastError === null ? '' : ` lastError=${event.lastError}`}`
      )
    case 'deal_conflict':
      return `MT5 deal replay differs from the first-seen record (${event.account}); first-seen kept`
    case 'dropped':
      return `MT5 bridge dropped connection ${event.connectionId}: ${event.reason}`
    case 'disconnected':
      return `MT5 disconnected${event.account === null ? '' : ` (${event.account})`}`
    case 'refused':
      return `MT5 bridge refused a connection: ${event.reason}`
    default:
      return null
  }
}

/**
 * Starts the spike receiver only when explicitly enabled
 * (SOLID_SKILL_MT5_BRIDGE=1). Failure to start (e.g. port in use) is logged
 * and swallowed: the application must run without MT5.
 */
export async function startMt5BridgeFromEnvironment(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void
): Promise<Mt5Receiver | null> {
  if (env['SOLID_SKILL_MT5_BRIDGE'] !== '1') return null
  const port = Number(env['SOLID_SKILL_MT5_PORT'] ?? DEFAULT_MT5_BRIDGE_PORT)
  const receiver = new Mt5Receiver({
    port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : DEFAULT_MT5_BRIDGE_PORT,
    bridgeKey: env['SOLID_SKILL_MT5_BRIDGE_KEY'] ?? null,
    onEvent: (event) => {
      const line = describeBridgeEvent(event)
      if (line !== null) log(line)
    }
  })
  try {
    await receiver.start()
    return receiver
  } catch {
    return null // already reported through onEvent('listen_error')
  }
}
