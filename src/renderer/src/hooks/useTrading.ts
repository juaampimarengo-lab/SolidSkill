import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IpcResult } from '@shared/ipc/result'
import type { DayDto, TradeDetailDto, TradeListDto, TradesApi } from '@shared/ipc/trades'
import { toTradingData, type TradingData } from '@renderer/lib/tradingScope'

export type { TradingData }

// SQLite (in the main process) is the source of truth for trading data. These
// hooks hold no authoritative state: they request coherent list / detail / day
// views over the typed preload API and render what came back. There is
// deliberately NO fallback to fixtures — an unavailable or failing database is
// a visible 'error' state, never fake or empty trading data.

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; data: T }

const UNAVAILABLE = 'Trading data is unavailable: the application bridge did not load.'
const REQUEST_FAILED = 'The request could not be completed.'

function useTradesQuery<T>(
  load: (api: TradesApi) => Promise<IpcResult<T>>,
  key: string
): { state: Loadable<T>; refresh: () => void; retry: () => void } {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' })
  const sequence = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const run = useCallback((silent: boolean): void => {
    const mine = (sequence.current += 1)
    const api = window.solidSkill?.trades
    if (!api) {
      setState({ status: 'error', message: UNAVAILABLE })
      return
    }
    if (!silent) setState({ status: 'loading' })
    loadRef
      .current(api)
      .then((result) => {
        if (mine !== sequence.current) return // superseded by a newer request or unmounted
        setState(
          result.ok
            ? { status: 'ready', data: result.data }
            : { status: 'error', message: result.error.message, code: result.error.code }
        )
      })
      .catch(() => {
        if (mine === sequence.current) setState({ status: 'error', message: REQUEST_FAILED })
      })
  }, [])

  useEffect(() => {
    run(false)
    return () => {
      sequence.current += 1
    }
  }, [key, run])

  return { state, refresh: () => run(true), retry: () => run(false) }
}

export interface UseTrading {
  state: Loadable<TradingData>
  /** Silent re-read (keeps showing current data meanwhile). */
  refresh: () => void
  retry: () => void
}

export function useTrading(activeAccountId: string | null): UseTrading {
  const query = useTradesQuery<TradeListDto>((api) => api.list(), 'list')
  const state = useMemo<Loadable<TradingData>>(
    () => (query.state.status === 'ready' ? { status: 'ready', data: toTradingData(query.state.data, activeAccountId) } : query.state),
    [query.state, activeAccountId]
  )

  // Automatic MT5 reconciliation (Checkpoint 012B-4) pushes this after it
  // persists new Trades. A silent re-read keeps Journal/Calendar/Dashboard
  // current without the user switching accounts or sections.
  const refreshRef = useRef(query.refresh)
  refreshRef.current = query.refresh
  useEffect(() => {
    const unsubscribe = window.solidSkill?.trades.onDataChanged(() => refreshRef.current())
    return unsubscribe
  }, [])

  return { state, refresh: query.refresh, retry: query.retry }
}

/** Full persisted detail of one Trade (executions, exact strategy version, notes, siblings). */
export function useTradeDetail(tradeId: string): { state: Loadable<TradeDetailDto>; retry: () => void } {
  const { state, retry } = useTradesQuery<TradeDetailDto>((api) => api.getDetail(tradeId), `trade:${tradeId}`)
  return { state, retry }
}

/** One analytical day of one account. */
export function useDay(accountId: string, date: string): { state: Loadable<DayDto>; retry: () => void } {
  const { state, retry } = useTradesQuery<DayDto>((api) => api.getDay({ accountId, date }), `day:${accountId}:${date}`)
  return { state, retry }
}
