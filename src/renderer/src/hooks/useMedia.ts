import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcResult } from '@shared/ipc/result'
import type { MediaApi, MediaItemDto } from '@shared/ipc/media'

// Chart Evidence (Checkpoint 014). SQLite + the managed media folder are the
// source of truth; there is deliberately no fixture fallback — an
// unavailable database is a visible error state, matching every other
// trading surface (see useTrading.ts).

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; data: T }

const UNAVAILABLE = 'Chart evidence is unavailable: the application bridge did not load.'
const REQUEST_FAILED = 'The request could not be completed.'

function useMediaQuery(
  load: (api: MediaApi) => Promise<IpcResult<MediaItemDto[]>>,
  key: string
): { state: Loadable<MediaItemDto[]>; refresh: () => void; retry: () => void } {
  const [state, setState] = useState<Loadable<MediaItemDto[]>>({ status: 'loading' })
  const sequence = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const run = useCallback((silent: boolean): void => {
    const mine = (sequence.current += 1)
    const api = window.solidSkill?.media
    if (!api) {
      setState({ status: 'error', message: UNAVAILABLE })
      return
    }
    if (!silent) setState({ status: 'loading' })
    loadRef
      .current(api)
      .then((result) => {
        if (mine !== sequence.current) return
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

export function useTradeMedia(tradeId: string): { state: Loadable<MediaItemDto[]>; refresh: () => void; retry: () => void } {
  return useMediaQuery((api) => api.listForTrade(tradeId), `trade-media:${tradeId}`)
}

export function useDayMedia(
  accountId: string,
  date: string
): { state: Loadable<MediaItemDto[]>; refresh: () => void; retry: () => void } {
  return useMediaQuery((api) => api.listForDay({ accountId, date }), `day-media:${accountId}:${date}`)
}
