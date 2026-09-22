import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcResult } from '@shared/ipc/result'

// Deliberate autosave for long-form authored text (Weekly Review reflection,
// Day Note). The local draft is the source of truth for what the textarea
// shows; the server response never overwrites text the user is still typing.
//
//  - edits are debounced (never one write per keystroke);
//  - only fields changed since the last successful save are sent;
//  - edits made while a save is in flight are queued and saved next;
//  - a failed save keeps the text and the dirty fields, and shows 'error'
//    until a retry (or the next edit) succeeds;
//  - pending text is flushed on blur, on unmount (switching week / section /
//    account) and on window unload, so navigating away never silently drops it.

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface UseAutosave<F extends string> {
  values: Record<F, string>
  status: SaveStatus
  setField: (field: F, value: string) => void
  /** Save any pending edits now (e.g. on blur). */
  flush: () => void
}

export function useAutosave<F extends string>(
  initial: Record<F, string>,
  save: (patch: Partial<Record<F, string>>) => Promise<IpcResult<unknown>>,
  delayMs = 800
): UseAutosave<F> {
  const [values, setValues] = useState<Record<F, string>>(initial)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const valuesRef = useRef(values)
  const dirty = useRef(new Set<F>())
  const inFlight = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  saveRef.current = save
  const mounted = useRef(true)

  const run = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inFlight.current || dirty.current.size === 0) return
    const fields = [...dirty.current]
    dirty.current.clear()
    const patch = {} as Partial<Record<F, string>>
    for (const field of fields) patch[field] = valuesRef.current[field]
    inFlight.current = true
    if (mounted.current) setStatus('saving')
    const settle = (ok: boolean): void => {
      inFlight.current = false
      if (!ok) for (const field of fields) dirty.current.add(field)
      if (dirty.current.size > 0 && ok) {
        run()
        return
      }
      if (mounted.current) setStatus(ok ? 'saved' : 'error')
    }
    saveRef
      .current(patch)
      .then((result) => settle(result.ok))
      .catch(() => settle(false))
  }, [])

  const setField = useCallback(
    (field: F, value: string): void => {
      valuesRef.current = { ...valuesRef.current, [field]: value }
      setValues(valuesRef.current)
      dirty.current.add(field)
      setStatus('pending')
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(run, delayMs)
    },
    [run, delayMs]
  )

  useEffect(() => {
    mounted.current = true
    const onUnload = (): void => run()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      mounted.current = false
      run()
    }
  }, [run])

  return { values, status, setField, flush: run }
}
