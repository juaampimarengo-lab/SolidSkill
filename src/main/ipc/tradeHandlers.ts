import type { IpcResult } from '../../shared/ipc/result'
import { TRADE_CHANNELS } from '../../shared/ipc/trades'
import type { TradeChannel } from '../../shared/ipc/trades'
import { ServiceError } from '../serviceError'
import type { TradingService } from '../trading/tradingService'
import {
  assignStrategyVersionInput,
  dayInput,
  dayNoteInput,
  ruleEvaluationInput,
  tradeId,
  tradeListInput,
  tradeNoteInput
} from './validation'

export type TradeHandler = (payload: unknown) => IpcResult<unknown>

export interface TradeHandlerDeps {
  /** null when the database failed to initialize; every call then reports PERSISTENCE_UNAVAILABLE. */
  getService: () => TradingService | null
  log: (message: string, error: unknown) => void
}

/**
 * One handler per Trading channel: validate the untrusted payload, run the
 * service, and turn every outcome (including exceptions) into a serializable
 * IpcResult. Free of Electron imports so it is testable.
 */
export function createTradeHandlers(deps: TradeHandlerDeps): Record<TradeChannel, TradeHandler> {
  function run<T>(fn: (service: TradingService) => T): IpcResult<T> {
    const service = deps.getService()
    if (service === null) {
      return {
        ok: false,
        error: {
          code: 'PERSISTENCE_UNAVAILABLE',
          message: 'The local database could not be opened, so trades cannot be loaded or saved.'
        }
      }
    }
    try {
      return { ok: true, data: fn(service) }
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, error: { code: error.code, message: error.message } }
      deps.log('unexpected error in trade handler', error)
      return { ok: false, error: { code: 'INTERNAL', message: 'An unexpected error occurred.' } }
    }
  }

  const C = TRADE_CHANNELS
  return {
    [C.list]: (p) => run((s) => s.list(tradeListInput(p))),
    [C.getDetail]: (p) => run((s) => s.getDetail(tradeId(p))),
    [C.getDay]: (p) =>
      run((s) => {
        const input = dayInput(p)
        return s.getDay(input.accountId, input.date)
      }),
    [C.updateTradeNote]: (p) =>
      run((s) => {
        const input = tradeNoteInput(p)
        return s.updateTradeNote(input.tradeId, input.body)
      }),
    [C.updateDayNote]: (p) =>
      run((s) => {
        const input = dayNoteInput(p)
        return s.updateDayNote(input.accountId, input.date, input.body)
      }),
    [C.updateRuleEvaluation]: (p) =>
      run((s) => {
        const input = ruleEvaluationInput(p)
        return s.updateRuleEvaluation(input.tradeId, input.ruleId, input.state)
      }),
    [C.assignStrategyVersion]: (p) =>
      run((s) => {
        const input = assignStrategyVersionInput(p)
        return s.assignStrategyVersion(input.tradeId, input.strategyVersionId)
      })
  }
}
