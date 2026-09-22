export * from './protocol'
export * from './rawStaging'
export * from './transport'
export * from './adapter'
export * from './fakeTransport'
export * from './normalizer'

import type { TradovateAdapterEvent } from './adapter'

/** Compact, non-sensitive log line for a Tradovate adapter event. */
export function describeTradovateAdapterEvent(event: TradovateAdapterEvent): string | null {
  switch (event.kind) {
    case 'connected':
      return 'Tradovate adapter connected'
    case 'disconnected':
      return 'Tradovate adapter disconnected'
    case 'history_synced':
      return (
        `Tradovate history synced (account ***${event.accountId.slice(-3)}): received ${event.received}, ` +
        `staged ${event.staged}, duplicates ${event.duplicates}, conflicts ${event.conflicts}`
      )
    case 'live_fill_staged':
      return `Tradovate live fill ${event.outcome} (account ***${event.accountId.slice(-3)})`
    case 'auth_error':
      return `Tradovate authentication failed: ${event.message}`
    default:
      return null
  }
}

/**
 * NOT WIRED YET — no real TradovateTransport implementation exists in this
 * spike (see docs/TRADOVATE_INTEGRATION_SPIKE.md, "Real access gate"). This
 * function documents the intended environment-gated shape (mirroring the MT5
 * bridge's `SOLID_SKILL_MT5_BRIDGE` pattern) so a future checkpoint that adds
 * a real HTTP/WebSocket `TradovateTransport` only has to supply that
 * transport, never redesign the gate.
 *
 * Deliberately returns null always in this checkpoint: no real connection is
 * attempted, and no credentials are read from the environment, because there
 * is nothing yet that would consume them safely.
 */
export function isTradovateAdapterEnabled(env: NodeJS.ProcessEnv): boolean {
  return env['SOLID_SKILL_TRADOVATE_ADAPTER'] === '1'
}
