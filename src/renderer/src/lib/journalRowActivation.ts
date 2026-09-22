// Pure decision logic for Journal row interaction (Checkpoint 014): a single
// click only selects the row / updates the quick preview; a double-click or
// an Enter key press navigates to the trade's Full Review — unless the event
// originated from an interactive control inside the row (a future action
// button, link, etc.), in which case the row ignores it.
//
// Kept framework-free (duck-typed target, no DOM/React import) so it can be
// unit-tested without a browser or Electron runtime.

export interface RowActivationTarget {
  closest(selector: string): unknown
}

const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"]'

export function isInteractiveRowTarget(target: RowActivationTarget | null | undefined): boolean {
  if (target === null || target === undefined || typeof target.closest !== 'function') return false
  return target.closest(INTERACTIVE_SELECTOR) !== null
}

export type RowActivationSource = 'click' | 'doubleClick' | 'enterKey'
export type RowActivationEffect = 'select' | 'openFull' | 'ignore'

export function decideRowActivation(
  source: RowActivationSource,
  target: RowActivationTarget | null | undefined
): RowActivationEffect {
  if (source === 'click') return 'select'
  if (isInteractiveRowTarget(target)) return 'ignore'
  return 'openFull'
}
