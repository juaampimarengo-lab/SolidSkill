/**
 * Result envelope returned by every IPC operation. The renderer never sees a
 * thrown exception from the main process: failures are data.
 *
 * Only JSON-serializable values cross the boundary (see docs/IPC_CONTRACT.md).
 */

export type IpcErrorCode =
  /** The database could not be opened at startup; nothing can be read or written. */
  | 'PERSISTENCE_UNAVAILABLE'
  /** The request payload was malformed or out of bounds. */
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  /** The request conflicts with current state (e.g. duplicate name, draft already exists). */
  | 'CONFLICT'
  /** A product rule refused the operation (e.g. publish blocked, published version immutable). */
  | 'RULE_VIOLATION'
  /** Unexpected failure. Details are logged in the main process, not sent. */
  | 'INTERNAL'

export interface IpcError {
  code: IpcErrorCode
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }
