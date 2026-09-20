/**
 * Public surface of the main-process persistence layer. Nothing outside
 * src/main may import from here, and nothing here exposes the raw SQLite
 * connection. A narrow IPC boundary (a later checkpoint) will expose
 * application-level operations built on these repositories.
 */
export { Database } from './database'
export type { DatabaseHealth, OpenOptions, Repositories } from './database'
export { DECIMAL_SCALE, decimalToScaled, scaledToDecimal } from './fixedPoint'
export type { Decimal } from './fixedPoint'
export type * from './types'
