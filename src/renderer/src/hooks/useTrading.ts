import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IpcResult } from '@shared/ipc/result'
import type { AccountDto, DayDto, TradeDetailDto, TradeListDto, TradesApi } from '@shared/ipc/trades'
import type { TradeSummary } from '@renderer/types/journal'

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

/** The single Trade universe every summary surface reads. */
export interface TradingData {
  accounts: AccountDto[]
  /** Every persisted trade, chronological. Strategy views filter this by stable strategy id. */
  allTrades: TradeSummary[]
  /**
   * The active account context. There is no Accounts UI yet, so this is the
   * first account that has trades (else the first account). Dashboard,
   * Calendar, Journal and Day Review show this account's trades.
   */
  account: AccountDto | null
  trades: TradeSummary[]
  /** Analytical dates (of the active account) that have a Day Note. */
  noteDates: ReadonlySet<string>
}

function toTradingData(list: TradeListDto): TradingData {
  const withTrades = new Set(list.trades.map((t) => t.accountId))
  const account = list.accounts.find((a) => withTrades.has(a.id)) ?? list.accounts[0] ?? null
  return {
    accounts: list.accounts,
    allTrades: list.trades,
    account,
    trades: account === null ? [] : list.trades.filter((t) => t.accountId === account.id),
    noteDates: new Set(
      list.daysWithNotes.filter((d) => account !== null && d.accountId === account.id).map((d) => d.date)
    )
  }
}

export interface UseTrading {
  state: Loadable<TradingData>
  /** Silent re-read (keeps showing current data meanwhile). */
  refresh: () => void
  retry: () => void
}

export function useTrading(): UseTrading {
  const query = useTradesQuery<TradeListDto>((api) => api.list(), 'list')
  const state = useMemo<Loadable<TradingData>>(
    () => (query.state.status === 'ready' ? { status: 'ready', data: toTradingData(query.state.data) } : query.state),
    [query.state]
  )
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
