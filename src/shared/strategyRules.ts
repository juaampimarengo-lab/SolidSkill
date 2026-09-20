/**
 * Pure Strategy rules used identically by the main-process service
 * (authoritative enforcement) and the renderer (immediate UI feedback), so
 * the two can never disagree about when a Draft may be published.
 *
 * Structure comparison ignores ids on purpose: a Draft's rows get fresh ids
 * when copied from a published version, so "changed" means changed content.
 */

export interface RuleShape {
  name: string
  kind: string
  description: string
}

export interface GroupShape {
  name: string
  rules: readonly RuleShape[]
}

export function ruleCount(groups: readonly GroupShape[]): number {
  return groups.reduce((n, g) => n + g.rules.length, 0)
}

export function structureSignature(groups: readonly GroupShape[]): string {
  return JSON.stringify(
    groups.map((g) => [g.name, g.rules.map((r) => [r.name, r.kind, r.description])])
  )
}

/**
 * Reason the Draft cannot be published, or null when it can. Only rule logic
 * versions: name/description are Strategy metadata and live outside the Draft
 * (docs/STRATEGY_VERSIONING.md §7).
 */
export function draftPublishBlocker(
  draftGroups: readonly GroupShape[],
  baseGroups: readonly GroupShape[] | null,
  baseNumber: number | null
): string | null {
  if (ruleCount(draftGroups) === 0) return 'Add at least one rule before publishing'
  if (draftGroups.some((g) => g.name.trim() === '')) return 'Every group needs a name'
  if (draftGroups.some((g) => g.rules.length === 0)) return 'Remove or fill empty groups before publishing'
  if (baseGroups !== null && structureSignature(draftGroups) === structureSignature(baseGroups)) {
    return `No rule changes from v${baseNumber}`
  }
  return null
}

/**
 * A deliberately tiny rule-level summary of what changed between two
 * published versions, matched by rule name (rules have no cross-version
 * identity in V1). A rename therefore reads as one removal plus one addition.
 * Not a structural diff engine.
 */
export function summarizeChanges(before: readonly GroupShape[] | null, after: readonly GroupShape[]): string[] {
  if (before === null) return ['Initial version']
  const flat = (groups: readonly GroupShape[]): Map<string, RuleShape> =>
    new Map(groups.flatMap((g) => g.rules.map((r): [string, RuleShape] => [r.name, r])))
  const prev = flat(before)
  const next = flat(after)
  const lines: string[] = []
  next.forEach((r, name) => {
    const old = prev.get(name)
    if (!old) lines.push(`+ ${name}`)
    else if (old.description !== r.description || old.kind !== r.kind) lines.push(`${name} updated`)
  })
  prev.forEach((_r, name) => {
    if (!next.has(name)) lines.push(`− ${name}`)
  })
  if (lines.length === 0) lines.push('Grouping or ordering changed')
  return lines
}
