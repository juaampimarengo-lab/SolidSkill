import type { IpcResult } from '../../shared/ipc/result'
import { REVIEW_CHANNELS } from '../../shared/ipc/reviews'
import type { ReviewChannel } from '../../shared/ipc/reviews'
import { ServiceError } from '../serviceError'
import type { ReviewService } from '../review/reviewService'
import { accountIdInput, saveScorecardInput, saveWeekInput, weekInput } from './validation'

export type ReviewHandler = (payload: unknown) => IpcResult<unknown>

export interface ReviewHandlerDeps {
  /** null when the database failed to initialize; every call then reports PERSISTENCE_UNAVAILABLE. */
  getService: () => ReviewService | null
  log: (message: string, error: unknown) => void
}

/**
 * One handler per Weekly Review channel: validate the untrusted payload, run
 * the service, and turn every outcome into a serializable IpcResult. Free of
 * Electron imports so it is testable (mirrors tradeHandlers.ts).
 */
export function createReviewHandlers(deps: ReviewHandlerDeps): Record<ReviewChannel, ReviewHandler> {
  function run<T>(fn: (service: ReviewService) => T): IpcResult<T> {
    const service = deps.getService()
    if (service === null) {
      return {
        ok: false,
        error: {
          code: 'PERSISTENCE_UNAVAILABLE',
          message: 'The local database could not be opened, so weekly reviews cannot be loaded or saved.'
        }
      }
    }
    try {
      return { ok: true, data: fn(service) }
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, error: { code: error.code, message: error.message } }
      deps.log('unexpected error in review handler', error)
      return { ok: false, error: { code: 'INTERNAL', message: 'An unexpected error occurred.' } }
    }
  }

  const C = REVIEW_CHANNELS
  return {
    [C.getWeek]: (p) =>
      run((s) => {
        const input = weekInput(p)
        return s.getWeek(input.accountId, input.weekStart)
      }),
    [C.saveWeek]: (p) =>
      run((s) => {
        const input = saveWeekInput(p)
        return s.saveWeek(input.accountId, input.weekStart, input.fields)
      }),
    [C.saveScorecard]: (p) =>
      run((s) => {
        const input = saveScorecardInput(p)
        return s.saveScorecard(input.accountId, input.weekStart, input.entries)
      }),
    [C.listWeeks]: (p) => run((s) => s.listWeeks(accountIdInput(p)))
  }
}
