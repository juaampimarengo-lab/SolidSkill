// Read-only helpers over the renderer's Strategy view model. Strategy data is
// owned by the main process (SQLite); every edit — draft changes, publish,
// discard, archive — is an IPC operation (see hooks/useStrategies.ts), not a
// local mutation. Publish validation is the SAME shared function the main
// process enforces, so the UI's "Publish" button state can never disagree
// with what the database layer will accept.

import { draftPublishBlocker, ruleCount as sharedRuleCount } from '@shared/strategyRules'
import type { RuleGroupDef, Strategy, StrategyVersion } from '@renderer/types/strategy'

export function currentVersion(strategy: Strategy): StrategyVersion | null {
  return strategy.versions[strategy.versions.length - 1] ?? null
}

export function ruleCount(groups: readonly RuleGroupDef[]): number {
  return sharedRuleCount(groups)
}

// Reason the draft cannot be published yet, or null when it can. Advisory for
// the UI; the main process re-validates authoritatively on publish.
export function publishBlocker(strategy: Strategy): string | null {
  const draft = strategy.draft
  if (!draft) return 'No draft'
  const base = currentVersion(strategy)
  return draftPublishBlocker(draft.groups, base?.groups ?? null, draft.basedOn)
}
