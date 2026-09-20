// Static Strategy fixtures for the Checkpoint 010 Strategy Builder
// workspace. Every name below is generic USER DATA — nothing methodology-
// specific. Published versions are deep-frozen: attempting to mutate one
// throws in strict mode, so immutability is enforced, not just conventional.
//
// `getSeedVersion` resolves the ORIGINAL fixture version snapshots. Trade
// Review reads structure from here (never from live workspace session
// state), so editing/publishing in the workspace can never alter how a
// historical trade's saved version renders.

import type { RuleDef, RuleGroupDef, RuleKind, Strategy, StrategyVersion } from '@renderer/types/strategy'

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  }
  return value
}

function rule(id: string, name: string, kind: RuleKind, description: string): RuleDef {
  return { id, name, kind, description }
}

function group(id: string, name: string, rules: RuleDef[]): RuleGroupDef {
  return { id, name, rules }
}

function version(number: number, publishedOn: string, groups: RuleGroupDef[], changes: string[]): StrategyVersion {
  return deepFreeze({ number, publishedOn, groups, changes })
}

// ---------------------------------------------------------------- Alpha

const alphaV1 = version(
  1,
  'Jun 2, 2026',
  [
    group('a-ga', 'Group A', [
      rule('a-ra', 'Rule A', 'Required', 'Generic description for Rule A — first wording.'),
      rule('a-rb', 'Rule B', 'Required', 'Generic description for Rule B — first wording.')
    ]),
    group('a-gb', 'Group B', [rule('a-rd', 'Rule D', 'Optional', 'Generic description for Rule D.')])
  ],
  ['Initial version']
)

const alphaV2 = version(
  2,
  'Jul 14, 2026',
  [
    group('a-ga', 'Group A', [
      rule('a-ra', 'Rule A', 'Required', 'Generic description for Rule A — clarified wording.'),
      rule('a-rb', 'Rule B', 'Required', 'Generic description for Rule B — first wording.'),
      rule('a-rc', 'Rule C', 'Conditional', 'Generic description for Rule C.')
    ]),
    group('a-gb', 'Group B', [rule('a-rd', 'Rule D', 'Optional', 'Generic description for Rule D.')])
  ],
  ['+ Rule C', 'Rule A wording updated']
)

const alphaV3 = version(
  3,
  'Aug 30, 2026',
  [
    group('a-ga', 'Group A', [
      rule('a-ra', 'Rule A', 'Required', 'Generic description for Rule A — clarified wording.'),
      rule('a-rb', 'Rule B', 'Required', 'Generic description for Rule B — tightened wording.'),
      rule('a-rc', 'Rule C', 'Conditional', 'Generic description for Rule C.')
    ]),
    group('a-gb', 'Group B', [
      rule('a-rd', 'Rule D', 'Optional', 'Generic description for Rule D.'),
      rule('a-re', 'Rule E', 'Optional', 'Generic description for Rule E.')
    ])
  ],
  ['+ Rule E', 'Rule B wording updated']
)

// ----------------------------------------------------------------- Beta

const betaV1 = version(
  1,
  'Jul 21, 2026',
  [
    group('b-ga', 'Group A', [
      rule('b-ra', 'Rule A', 'Required', 'Generic description for Rule A (Strategy Beta).'),
      rule('b-rb', 'Rule B', 'Optional', 'Generic description for Rule B (Strategy Beta).')
    ]),
    group('b-gb', 'Group B', [
      rule('b-rc', 'Rule C', 'Conditional', 'Generic description for Rule C (Strategy Beta).')
    ]),
    group('b-gc', 'Group C', [
      rule('b-rd', 'Rule D', 'Required', 'Generic description for Rule D (Strategy Beta).'),
      rule('b-re', 'Rule E', 'Optional', 'Generic description for Rule E (Strategy Beta).')
    ])
  ],
  ['Initial version']
)

// ---------------------------------------------------------------- Gamma

const gammaV1 = version(
  1,
  'May 11, 2026',
  [
    group('g-ga', 'Group A', [
      rule('g-ra', 'Rule A', 'Required', 'Generic description for Rule A (Strategy Gamma).'),
      rule('g-rb', 'Rule B', 'Optional', 'Generic description for Rule B (Strategy Gamma).')
    ])
  ],
  ['Initial version']
)

export const seedStrategies: Strategy[] = [
  {
    id: 'strategy-alpha',
    name: 'Strategy Alpha',
    description: 'Generic fixture strategy with two rule groups. Labels are user data, not application concepts.',
    status: 'Active',
    versions: [alphaV1, alphaV2, alphaV3],
    draft: null
  },
  {
    id: 'strategy-beta',
    name: 'Strategy Beta',
    description: 'Generic fixture strategy with three rule groups and a different composition.',
    status: 'Active',
    versions: [betaV1],
    draft: null
  },
  {
    id: 'strategy-gamma',
    name: 'Strategy Gamma',
    description: 'Retired fixture strategy, kept to demonstrate the archived lifecycle state.',
    status: 'Archived',
    versions: [gammaV1],
    draft: null
  }
]

export function getSeedVersion(strategyName: string, versionLabel: string): StrategyVersion | null {
  const strategy = seedStrategies.find((s) => s.name === strategyName)
  const number = Number(versionLabel.replace(/^v/, ''))
  return strategy?.versions.find((v) => v.number === number) ?? null
}
