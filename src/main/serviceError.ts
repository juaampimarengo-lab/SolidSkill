import type { IpcErrorCode } from '../shared/ipc/result'

/** A failure with an application-level code that the IPC layer can return as data. */
export class ServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}
