import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcResult } from '@shared/ipc/result'
import type { DraftEdit, StrategiesApi, StrategyDto } from '@shared/ipc/strategies'
import { strategyFromDto } from '@renderer/lib/strategyMapping'
import type { Strategy } from '@renderer/types/strategy'

// SQLite (in the main process) is the source of truth. This hook holds no
// authoritative state: every action awaits the main process and then replaces
// the affected strategy with what was actually persisted. There is no
// optimistic update and, deliberately, NO fallback to fixtures — if
// persistence is unavailable the state is 'error', never fake empty data.

export type StrategiesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; strategies: Strategy[] }

export interface StrategyActions {
  create: (name: string, description: string) => Promise<Strategy | null>
  updateDetails: (id: string, name: string, description: string) => Promise<boolean>
  setArchived: (id: string, archived: boolean) => Promise<boolean>
  removeUnpublished: (id: string) => Promise<boolean>
  beginDraft: (id: string) => Promise<boolean>
  discardDraft: (id: string) => Promise<boolean>
  editDraft: (id: string, edit: DraftEdit) => Promise<boolean>
  publishDraft: (id: string) => Promise<boolean>
  /** Moves a strategy within its own section. List order only — never a Draft or Version. */
  move: (id: string, toIndex: number) => Promise<boolean>
}

export interface UseStrategies {
  state: StrategiesState
  actions: StrategyActions
  /** Message from the last failed action (validation refused, etc.); null when none. */
  actionError: string | null
  dismissActionError: () => void
  reload: () => void
}

const UNAVAILABLE = 'Strategies are unavailable: the application bridge did not load.'

function getApi(): StrategiesApi | null {
  return window.solidSkill?.strategies ?? null
}

export function useStrategies(): UseStrategies {
  const [state, setState] = useState<StrategiesState>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(() => {
    setState({ status: 'loading' })
    const api = getApi()
    if (!api) {
      setState({ status: 'error', message: UNAVAILABLE })
      return
    }
    api
      .list()
      .then((result) => {
        if (!mounted.current) return
        setState(
          result.ok
            ? { status: 'ready', strategies: result.data.map(strategyFromDto) }
            : { status: 'error', message: result.error.message }
        )
      })
      .catch(() => {
        if (mounted.current) setState({ status: 'error', message: UNAVAILABLE })
      })
  }, [])

  useEffect(load, [load])

  // Runs one IPC operation; on success `apply` folds the persisted result into state.
  const call = useCallback(
    async <T,>(op: () => Promise<IpcResult<T>>, apply: (data: T) => void): Promise<boolean> => {
      setActionError(null)
      try {
        const result = await op()
        if (!mounted.current) return false
        if (!result.ok) {
          setActionError(result.error.message)
          return false
        }
        apply(result.data)
        return true
      } catch {
        if (mounted.current) setActionError('The request could not be completed.')
        return false
      }
    },
    []
  )

  const replace = useCallback((dto: StrategyDto): void => {
    const next = strategyFromDto(dto)
    setState((s) =>
      s.status === 'ready' ? { status: 'ready', strategies: s.strategies.map((x) => (x.id === next.id ? next : x)) } : s
    )
  }, [])

  const withApi = useCallback(
    async <T,>(pick: (a: StrategiesApi) => Promise<IpcResult<T>>, apply: (d: T) => void) => {
      const a = getApi()
      if (!a) {
        setActionError(UNAVAILABLE)
        return false
      }
      return call(() => pick(a), apply)
    },
    [call]
  )

  const actions: StrategyActions = {
    create: async (name, description) => {
      let created: Strategy | null = null
      await withApi(
        (a) => a.create({ name, description }),
        (dto) => {
          created = strategyFromDto(dto)
          const next = created
          setState((s) => (s.status === 'ready' ? { status: 'ready', strategies: [...s.strategies, next] } : s))
        }
      )
      return created
    },
    updateDetails: (strategyId, name, description) =>
      withApi((a) => a.updateDetails({ strategyId, name, description }), replace),
    setArchived: (id, archived) => withApi((a) => (archived ? a.archive(id) : a.restore(id)), replace),
    removeUnpublished: (id) =>
      withApi(
        (a) => a.deleteUnpublished(id),
        () =>
          setState((s) =>
            s.status === 'ready' ? { status: 'ready', strategies: s.strategies.filter((x) => x.id !== id) } : s
          )
      ),
    beginDraft: (id) => withApi((a) => a.beginDraft(id), replace),
    discardDraft: (id) => withApi((a) => a.discardDraft(id), replace),
    editDraft: (strategyId, edit) => withApi((a) => a.editDraft({ strategyId, edit }), replace),
    publishDraft: (id) => withApi((a) => a.publishDraft(id), replace),
    move: (strategyId, toIndex) =>
      withApi(
        (a) => a.move({ strategyId, toIndex }),
        (dtos) => setState({ status: 'ready', strategies: dtos.map(strategyFromDto) })
      )
  }

  return { state, actions, actionError, dismissActionError: () => setActionError(null), reload: load }
}
