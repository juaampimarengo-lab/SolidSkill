import type { Database, RuleKind } from '../persistence'

/**
 * DEVELOPMENT-ONLY demo data. Never called for a packaged app (see
 * src/main/index.ts), never part of normal repository behaviour.
 *
 * Policy (docs/PERSISTENCE.md "Development seed"):
 *  - runs only when the app is not packaged;
 *  - runs only when the strategies table is completely empty, so it is
 *    idempotent and can never duplicate "Strategy Alpha";
 *  - writes Strategy data only (generic Alpha/Beta/Gamma with their published
 *    versions) — never trades, executions, or evaluations;
 *  - goes through the real repositories, so seeded versions are immutable
 *    published versions like any other;
 *  - lands in the separate development userData folder, never in the
 *    production-named database.
 *
 * Every label below is generic user-style data, not an application concept.
 * This intentionally mirrors the renderer fixtures in
 * src/renderer/src/data/strategyDummyData.ts (still used by Trade Review
 * until 011B-2); keep the two in step or delete this file's duplicate when
 * trades move to persistence.
 */

interface SeedRule {
  name: string
  kind: RuleKind
  description: string
}
interface SeedGroup {
  name: string
  rules: SeedRule[]
}
interface SeedStrategy {
  name: string
  description: string
  archived: boolean
  versions: SeedGroup[][]
}

const r = (name: string, kind: RuleKind, description: string): SeedRule => ({ name, kind, description })

const SEED: SeedStrategy[] = [
  {
    name: 'Strategy Alpha',
    description: 'Generic fixture strategy with two rule groups. Labels are user data, not application concepts.',
    archived: false,
    versions: [
      [
        { name: 'Group A', rules: [
          r('Rule A', 'REQUIRED', 'Generic description for Rule A — first wording.'),
          r('Rule B', 'REQUIRED', 'Generic description for Rule B — first wording.')
        ] },
        { name: 'Group B', rules: [r('Rule D', 'OPTIONAL', 'Generic description for Rule D.')] }
      ],
      [
        { name: 'Group A', rules: [
          r('Rule A', 'REQUIRED', 'Generic description for Rule A — clarified wording.'),
          r('Rule B', 'REQUIRED', 'Generic description for Rule B — first wording.'),
          r('Rule C', 'CONDITIONAL', 'Generic description for Rule C.')
        ] },
        { name: 'Group B', rules: [r('Rule D', 'OPTIONAL', 'Generic description for Rule D.')] }
      ],
      [
        { name: 'Group A', rules: [
          r('Rule A', 'REQUIRED', 'Generic description for Rule A — clarified wording.'),
          r('Rule B', 'REQUIRED', 'Generic description for Rule B — tightened wording.'),
          r('Rule C', 'CONDITIONAL', 'Generic description for Rule C.')
        ] },
        { name: 'Group B', rules: [
          r('Rule D', 'OPTIONAL', 'Generic description for Rule D.'),
          r('Rule E', 'OPTIONAL', 'Generic description for Rule E.')
        ] }
      ]
    ]
  },
  {
    name: 'Strategy Beta',
    description: 'Generic fixture strategy with three rule groups and a different composition.',
    archived: false,
    versions: [
      [
        { name: 'Group A', rules: [
          r('Rule A', 'REQUIRED', 'Generic description for Rule A (Strategy Beta).'),
          r('Rule B', 'OPTIONAL', 'Generic description for Rule B (Strategy Beta).')
        ] },
        { name: 'Group B', rules: [r('Rule C', 'CONDITIONAL', 'Generic description for Rule C (Strategy Beta).')] },
        { name: 'Group C', rules: [
          r('Rule D', 'REQUIRED', 'Generic description for Rule D (Strategy Beta).'),
          r('Rule E', 'OPTIONAL', 'Generic description for Rule E (Strategy Beta).')
        ] }
      ]
    ]
  },
  {
    name: 'Strategy Gamma',
    description: 'Retired fixture strategy, kept to demonstrate the archived lifecycle state.',
    archived: true,
    versions: [
      [
        { name: 'Group A', rules: [
          r('Rule A', 'REQUIRED', 'Generic description for Rule A (Strategy Gamma).'),
          r('Rule B', 'OPTIONAL', 'Generic description for Rule B (Strategy Gamma).')
        ] }
      ]
    ]
  }
]

/** Seeds the demo strategies if (and only if) no strategy exists. Returns whether it seeded. */
export function seedDevelopmentStrategies(db: Database): boolean {
  const { strategies, strategyVersions } = db.repositories
  return db.transaction(() => {
    if (strategies.list({ includeArchived: true }).length > 0) return false
    for (const seed of SEED) {
      const strategy = strategies.create({ name: seed.name, description: seed.description })
      for (const groups of seed.versions) {
        const draft = strategyVersions.createDraft(strategy.id)
        for (const existing of strategyVersions.getDefinition(draft.id).groups) {
          strategyVersions.removeGroup(existing.id)
        }
        for (const group of groups) {
          const created = strategyVersions.addGroup(draft.id, { name: group.name })
          for (const rule of group.rules) {
            strategyVersions.addRule(created.id, { title: rule.name, kind: rule.kind, description: rule.description })
          }
        }
        strategyVersions.publishDraft(strategy.id)
      }
      if (seed.archived) strategies.setArchived(strategy.id, true)
    }
    return true
  })
}
