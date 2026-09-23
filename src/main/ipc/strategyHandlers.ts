import type { IpcResult } from '../../shared/ipc/result'
import { STRATEGY_CHANNELS } from '../../shared/ipc/strategies'
import type { StrategyChannel } from '../../shared/ipc/strategies'
import { ServiceError } from '../strategies/strategyService'
import type { StrategyService } from '../strategies/strategyService'
import { createInput, editDraftInput, moveStrategyInput, strategyId, updateDetailsInput } from './validation'

export type StrategyHandler = (payload: unknown) => IpcResult<unknown>

export interface HandlerDeps {
  /** null when the database failed to initialize; every call then reports PERSISTENCE_UNAVAILABLE. */
  getService: () => StrategyService | null
  log: (message: string, error: unknown) => void
}

/**
 * One handler per channel: validate the untrusted payload, run the service,
 * and turn every outcome (including exceptions) into a serializable
 * IpcResult. Deliberately free of Electron imports so it is testable.
 */
export function createStrategyHandlers(deps: HandlerDeps): Record<StrategyChannel, StrategyHandler> {
  function run<T>(fn: (service: StrategyService) => T): IpcResult<T> {
    const service = deps.getService()
    if (service === null) {
      return {
        ok: false,
        error: {
          code: 'PERSISTENCE_UNAVAILABLE',
          message: 'The local database could not be opened, so strategies cannot be loaded or saved.'
        }
      }
    }
    try {
      return { ok: true, data: fn(service) }
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, error: { code: error.code, message: error.message } }
      deps.log('unexpected error in strategy handler', error)
      return { ok: false, error: { code: 'INTERNAL', message: 'An unexpected error occurred while saving.' } }
    }
  }

  const C = STRATEGY_CHANNELS
  return {
    [C.list]: () => run((s) => s.list()),
    [C.create]: (p) => run((s) => s.create(createInput(p))),
    [C.updateDetails]: (p) => run((s) => s.updateDetails(updateDetailsInput(p))),
    [C.archive]: (p) => run((s) => s.archive(strategyId(p))),
    [C.restore]: (p) => run((s) => s.restore(strategyId(p))),
    [C.deleteUnpublished]: (p) =>
      run((s) => {
        s.deleteUnpublished(strategyId(p))
        return null
      }),
    [C.beginDraft]: (p) => run((s) => s.beginDraft(strategyId(p))),
    [C.discardDraft]: (p) => run((s) => s.discardDraft(strategyId(p))),
    [C.editDraft]: (p) =>
      run((s) => {
        const input = editDraftInput(p)
        return s.editDraft(input.strategyId, input.edit)
      }),
    [C.publishDraft]: (p) => run((s) => s.publishDraft(strategyId(p))),
    [C.move]: (p) => run((s) => s.move(moveStrategyInput(p)))
  }
}
