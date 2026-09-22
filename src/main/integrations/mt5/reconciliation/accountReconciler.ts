/**
 * Serializes and coalesces reconciliation triggers for ONE source account.
 *
 * Generic on purpose: it knows nothing about MT5, deals, or persistence. It
 * only guarantees the shape required by docs/MT5_RECONCILIATION.md:
 *
 *  - at most one `run()` active at a time;
 *  - a burst of `trigger()` calls before it fires collapses into ONE run
 *    (debounce/coalescing);
 *  - a `trigger()` that arrives WHILE `run()` is executing schedules exactly
 *    ONE follow-up run after the current one finishes (never queued deeper);
 *  - `cancel()` drops a pending (not yet started) run without affecting one
 *    already executing.
 */

export interface Scheduler {
  /** Schedules `fn` to run after `delayMs`. Returns a canceller. */
  schedule(fn: () => void, delayMs: number): () => void
}

/** Real timers, unref'd so a pending debounce never keeps the process alive. */
export function createRealTimeScheduler(): Scheduler {
  return {
    schedule(fn, delayMs) {
      const timer = setTimeout(fn, delayMs)
      if (typeof timer === 'object' && typeof (timer as { unref?: () => void }).unref === 'function') {
        ;(timer as unknown as { unref: () => void }).unref()
      }
      return () => clearTimeout(timer)
    }
  }
}

/**
 * Deterministic, synchronous fake scheduler for tests: `schedule` only
 * enqueues; nothing runs until `flush()` is called explicitly.
 */
export function createManualScheduler(): Scheduler & { flush(): void; pending(): number } {
  const queue: Array<{ fn: () => void; cancelled: boolean }> = []
  return {
    schedule(fn) {
      const entry = { fn, cancelled: false }
      queue.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    flush() {
      const due = queue.splice(0, queue.length)
      for (const entry of due) if (!entry.cancelled) entry.fn()
    },
    pending() {
      return queue.filter((e) => !e.cancelled).length
    }
  }
}

export interface AccountReconcilerOptions {
  readonly run: () => void
  readonly onError?: (error: unknown) => void
  readonly debounceMs?: number
  readonly scheduler?: Scheduler
}

export class AccountReconciler {
  private readonly debounceMs: number
  private readonly scheduler: Scheduler
  private cancelPending: (() => void) | null = null
  private running = false
  private pendingFollowUp = false

  constructor(private readonly options: AccountReconcilerOptions) {
    this.debounceMs = options.debounceMs ?? 300
    this.scheduler = options.scheduler ?? createRealTimeScheduler()
  }

  /** Requests a reconciliation run. Safe to call repeatedly and re-entrantly. */
  trigger(): void {
    if (this.cancelPending !== null) return // already coalesced into the scheduled run
    if (this.running) {
      this.pendingFollowUp = true
      return
    }
    this.cancelPending = this.scheduler.schedule(() => {
      this.cancelPending = null
      this.runNow()
    }, this.debounceMs)
  }

  /** Drops any pending (not yet started) scheduled run. A run in progress is left to finish. */
  cancel(): void {
    if (this.cancelPending !== null) {
      this.cancelPending()
      this.cancelPending = null
    }
    this.pendingFollowUp = false
  }

  get isRunning(): boolean {
    return this.running
  }

  private runNow(): void {
    this.running = true
    try {
      this.options.run()
    } catch (error) {
      this.options.onError?.(error)
    } finally {
      this.running = false
      if (this.pendingFollowUp) {
        this.pendingFollowUp = false
        this.trigger()
      }
    }
  }
}
