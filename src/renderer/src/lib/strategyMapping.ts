// Maps the main process's StrategyDto (IPC contract) onto the renderer's view
// model. Presentation concerns live here: date formatting, and deep-freezing
// published versions so no UI code can mutate one even by accident.

import type { StrategyDto } from '@shared/ipc/strategies'
import type { Strategy } from '@renderer/types/strategy'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  }
  return value
}

function formatPublished(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function strategyFromDto(dto: StrategyDto): Strategy {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    status: dto.status,
    versions: dto.versions.map((v) =>
      deepFreeze({
        number: v.number,
        publishedOn: formatPublished(v.publishedAt),
        groups: v.groups,
        changes: v.changes
      })
    ),
    draft: dto.draft ? { basedOn: dto.draft.basedOn, groups: dto.draft.groups } : null
  }
}
