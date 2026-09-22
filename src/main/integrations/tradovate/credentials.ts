/**
 * Real-credential loading for a Tradovate connectivity attempt (013B).
 *
 * SECRETS DISCIPLINE (see docs/TRADOVATE_INTEGRATION_SPIKE.md §"Real access
 * gate", CLAUDE.md Absolute Rule 6):
 *  - Credentials are read from environment variables only. Nothing here
 *    hardcodes, caches to disk, or writes a credential anywhere.
 *  - `describeMissingTradovateEnv` reports variable NAMES only, never values.
 *  - `maskTradovateCredentialName` exists so a log line can say "connecting
 *    as ***xyz" without ever printing the real `name` (username) in full.
 *
 * Per Tradovate's own API access model, a trading login alone is not
 * sufficient: `appId`/`appVersion`/`cid`/`sec` are Partner API application
 * credentials, obtained separately from a trading account
 * (https://support.tradovate.com/s/article/Tradovate-API-Access). This module
 * does not know or assume the user already has them — see
 * docs/TRADOVATE_REAL_QA.md for the exact manual step when they are missing.
 */
import type { TradovateCredentials } from './transport'

export type TradovateEnvironment = 'demo' | 'live'

export const TRADOVATE_ENV_VARS = {
  name: 'SOLID_SKILL_TRADOVATE_NAME',
  password: 'SOLID_SKILL_TRADOVATE_PASSWORD',
  appId: 'SOLID_SKILL_TRADOVATE_APP_ID',
  appVersion: 'SOLID_SKILL_TRADOVATE_APP_VERSION',
  cid: 'SOLID_SKILL_TRADOVATE_CID',
  sec: 'SOLID_SKILL_TRADOVATE_SEC',
  deviceId: 'SOLID_SKILL_TRADOVATE_DEVICE_ID',
  environment: 'SOLID_SKILL_TRADOVATE_ENVIRONMENT'
} as const

const REQUIRED_KEYS = ['name', 'password', 'appId', 'appVersion', 'cid', 'sec'] as const

export interface TradovateRealCredentials extends TradovateCredentials {
  readonly deviceId?: string
}

export interface TradovateCredentialLoadResult {
  readonly credentials: TradovateRealCredentials | null
  readonly environment: TradovateEnvironment
  /** Env var NAMES only — never a value, never partially. */
  readonly missing: readonly string[]
}

function resolveEnvironment(env: NodeJS.ProcessEnv): TradovateEnvironment {
  const raw = env[TRADOVATE_ENV_VARS.environment]
  return raw === 'live' ? 'live' : 'demo'
}

/** Reads Tradovate real-connectivity credentials from environment variables only. Never throws; reports what is missing by name. */
export function loadTradovateCredentialsFromEnv(env: NodeJS.ProcessEnv): TradovateCredentialLoadResult {
  const environment = resolveEnvironment(env)
  const missing: string[] = []
  for (const key of REQUIRED_KEYS) {
    if (!env[TRADOVATE_ENV_VARS[key]]) missing.push(TRADOVATE_ENV_VARS[key])
  }
  if (missing.length > 0) return { credentials: null, environment, missing }

  const deviceId = env[TRADOVATE_ENV_VARS.deviceId]
  return {
    environment,
    missing: [],
    credentials: {
      name: env[TRADOVATE_ENV_VARS.name] as string,
      password: env[TRADOVATE_ENV_VARS.password] as string,
      appId: env[TRADOVATE_ENV_VARS.appId] as string,
      appVersion: env[TRADOVATE_ENV_VARS.appVersion] as string,
      cid: env[TRADOVATE_ENV_VARS.cid] as string,
      sec: env[TRADOVATE_ENV_VARS.sec] as string,
      ...(deviceId === undefined ? {} : { deviceId })
    }
  }
}

/** Masks a Tradovate username for a log line: never prints it in full. */
export function maskTradovateCredentialName(name: string): string {
  return name.length <= 3 ? '***' : `***${name.slice(-3)}`
}

/** Human-readable guidance for the exact manual step when credentials are missing. Contains no secret. */
export function describeMissingTradovateEnv(missing: readonly string[]): string[] {
  if (missing.length === 0) return []
  return [
    'Real Tradovate connectivity is blocked: the following environment variables are not set:',
    ...missing.map((name) => `  - ${name}`),
    '',
    'A Tradovate trading login alone is not enough. Partner API application',
    'credentials (appId/appVersion/cid/sec) must be obtained separately from',
    'Tradovate — see https://support.tradovate.com/s/article/Tradovate-API-Access.',
    '',
    'Set these as local environment variables only (never commit them, never',
    'put them in a source file):',
    `  ${TRADOVATE_ENV_VARS.name}=<Tradovate username>`,
    `  ${TRADOVATE_ENV_VARS.password}=<Tradovate password>`,
    `  ${TRADOVATE_ENV_VARS.appId}=<Partner API appId>`,
    `  ${TRADOVATE_ENV_VARS.appVersion}=<Partner API appVersion>`,
    `  ${TRADOVATE_ENV_VARS.cid}=<Partner API cid>`,
    `  ${TRADOVATE_ENV_VARS.sec}=<Partner API sec>`,
    `  ${TRADOVATE_ENV_VARS.deviceId}=<optional device id>`,
    `  ${TRADOVATE_ENV_VARS.environment}=demo|live (default: demo)`
  ]
}
