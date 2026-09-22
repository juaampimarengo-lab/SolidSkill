/**
 * DEVELOPMENT-ONLY export of real Tradovate raw facts, captured for
 * structural QA (013B). Mirrors src/main/integrations/mt5/devSnapshot.ts,
 * independently implemented for Tradovate.
 *
 * - Writes ONLY to <cwd>/.dev-data/tradovate/tradovate-raw-<pseudonym>.json
 *   (gitignored via the existing `.dev-data/` rule — never committed).
 * - Account id and userId are replaced by stable one-way pseudonyms.
 *   Structural relationships needed for analysis (contractId, fillId,
 *   orderId, quantities, prices, timestamps) are preserved, per the
 *   checkpoint's explicit instruction not to pseudonymize structural
 *   relationships.
 * - Contains no credentials — nothing here ever sees a password/token.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { RawTradovateFill, RawTradovateFillFee, RawTradovateFillPair, RawTradovatePosition } from './protocol'

export const TRADOVATE_DEV_SNAPSHOT_FORMAT_VERSION = 1

export interface TradovateDevSnapshot {
  readonly formatVersion: typeof TRADOVATE_DEV_SNAPSHOT_FORMAT_VERSION
  readonly capturedAt: string
  readonly environment: 'demo' | 'live'
  readonly account: { readonly accountId: string }
  readonly fills: readonly RawTradovateFill[]
  readonly positions: readonly RawTradovatePosition[]
  readonly fillPairs: readonly RawTradovateFillPair[]
  readonly fillFees: readonly RawTradovateFillFee[]
}

function hashHex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function pseudonymAccountId(accountId: string): string {
  return `acct-${hashHex(`tradovate-account:${accountId}`).slice(0, 12)}`
}

export function devSnapshotDirectory(baseDir: string): string {
  return resolve(baseDir, '.dev-data', 'tradovate')
}

export function buildTradovateDevSnapshot(
  environment: 'demo' | 'live',
  accountId: string,
  fills: readonly RawTradovateFill[],
  positions: readonly RawTradovatePosition[],
  fillPairs: readonly RawTradovateFillPair[],
  fillFees: readonly RawTradovateFillFee[],
  capturedAt: string
): TradovateDevSnapshot {
  const pseudo = pseudonymAccountId(accountId)
  return {
    formatVersion: TRADOVATE_DEV_SNAPSHOT_FORMAT_VERSION,
    capturedAt,
    environment,
    account: { accountId: pseudo },
    fills: fills.map((f) => ({ ...f, accountId: pseudo })),
    positions: positions.map((p) => ({ ...p, accountId: pseudo })),
    fillPairs,
    fillFees
  }
}

/** Writes one pseudonymized snapshot file; returns the written path. */
export function writeTradovateDevSnapshot(baseDir: string, snapshot: TradovateDevSnapshot): string {
  const dir = devSnapshotDirectory(baseDir)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `tradovate-raw-${snapshot.account.accountId}.json`)
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return file
}
