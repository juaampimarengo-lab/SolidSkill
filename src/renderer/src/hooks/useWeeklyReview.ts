import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcResult } from '@shared/ipc/result'
import type { ReviewsApi, WeeklyReviewDto, WeeklyReviewWeeksDto } from '@shared/ipc/reviews'
import type { Loadable } from './useTrading'

// Weekly Review facts are persisted in SQLite (main process) and reached only
// through window.solidSkill.reviews. No fixture fallback: an unavailable
// database is a visible error state.

const UNAVAILABLE = 'Weekly review data is unavailable: the application bridge did not load.'
const REQUEST_FAILED = 'The request could not be completed.'

function useReviewQuery<T>(
  load: (api: ReviewsApi) => Promise<IpcResult<T>>,
  key: string
): { state: Loadable<T>; refresh: () => void; retry: () => void } {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' })
  const sequence = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const run = useCallback((silent: boolean): void => {
    const mine = (sequence.current += 1)
    const api = window.solidSkill?.reviews
    if (!api) {
      setState({ status: 'error', message: UNAVAILABLE })
      return
    }
    if (!silent) setState({ status: 'loading' })
    loadRef
      .current(api)
      .then((result) => {
        if (mine !== sequence.current) return // superseded (another week/account) or unmounted
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

/** One (account, week): the week's facts plus the authored reflection. */
export function useWeeklyReview(
  accountId: string,
  weekStart: string
): { state: Loadable<WeeklyReviewDto>; refresh: () => void; retry: () => void } {
  return useReviewQuery((api) => api.getWeek({ accountId, weekStart }), `week:${accountId}:${weekStart}`)
}

/** Weeks of this account that have Trades or an authored review (for week navigation). */
export function useReviewWeeks(accountId: string): { state: Loadable<WeeklyReviewWeeksDto>; refresh: () => void } {
  const { state, refresh } = useReviewQuery((api) => api.listWeeks(accountId), `weeks:${accountId}`)
  return { state, refresh }
}
