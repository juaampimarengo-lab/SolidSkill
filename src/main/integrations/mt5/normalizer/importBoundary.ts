/**
 * Narrow boundary for the NEXT checkpoint's import service. NOT invoked
 * anywhere in production code yet: nothing here touches SQLite, the
 * TradeRepository, or the renderer.
 *
 * The rule it encodes: only COMPLETED, proven lifecycles are import
 * candidates. Open lifecycles, unresolved lifecycles, ignored and rejected
 * deals are withheld and stay visible in the normalization result. The import
 * service (not the normalizer) owns Solid Skill UUID creation and maps
 * `sourceLifecycleKey` -> Trade.sourceTradeId/sourcePositionId and each
 * execution's `sourceExecutionKey` -> Execution.sourceExecutionId.
 */
import type { CompletedTradeCandidate, Mt5NormalizationResult } from './types'

export interface Mt5ImportPlan {
  /** Completed candidates whose sourceLifecycleKey is not yet known to the store. */
  readonly toCreate: readonly CompletedTradeCandidate[]
  /** Completed candidates already imported (matched by sourceLifecycleKey). */
  readonly alreadyImported: readonly CompletedTradeCandidate[]
  readonly withheldOpen: number
  readonly withheldUnresolved: number
}

export function planMt5Import(
  result: Mt5NormalizationResult,
  knownSourceLifecycleKeys: ReadonlySet<string>
): Mt5ImportPlan {
  const toCreate: CompletedTradeCandidate[] = []
  const alreadyImported: CompletedTradeCandidate[] = []
  for (const candidate of result.completed) {
    if (knownSourceLifecycleKeys.has(candidate.sourceLifecycleKey)) alreadyImported.push(candidate)
    else toCreate.push(candidate)
  }
  return { toCreate, alreadyImported, withheldOpen: result.open.length, withheldUnresolved: result.unresolved.length }
}
