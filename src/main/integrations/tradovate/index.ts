export * from './protocol'
export * from './rawStaging'
export * from './transport'
export * from './adapter'
export * from './fakeTransport'
export * from './normalizer'
export * from './credentials'
export * from './realTransport'
export * from './devSnapshot'
export * from './structuralReport'

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
 * NOT WIRED INTO APP STARTUP — `realTransport.ts` (013B) exists and is
 * exercised only by `scripts/tradovate-real-qa.mjs` (a manual, gated
 * development command), never by `src/main/index.ts` or any IPC path. This
 * function documents the intended environment-gated shape (mirroring the MT5
 * bridge's `SOLID_SKILL_MT5_BRIDGE` pattern) for a future checkpoint that
 * wires real Tradovate connectivity into the running app; that checkpoint is
 * explicitly not this one (no SQLite import path exists for Tradovate yet).
 */
export function isTradovateAdapterEnabled(env: NodeJS.ProcessEnv): boolean {
  return env['SOLID_SKILL_TRADOVATE_ADAPTER'] === '1'
}
