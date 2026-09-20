import { randomUUID } from 'node:crypto'

/** Stable opaque identifier (UUID v4). Carries no meaning; never derived from names, dates or indexes. */
export function newId(): string {
  return randomUUID()
}

/** Injectable clock so repositories are testable and timestamps are consistent. */
export type Clock = () => number
export const systemClock: Clock = () => Date.now()
