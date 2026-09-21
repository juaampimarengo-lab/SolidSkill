/**
 * Strategy IPC contract shared by main, preload, and renderer. This is the
 * application-level shape of Strategy data — NOT the persistence row shape
 * (no SQL conventions, no BigInt, no upper-case DB enums). Every value is
 * JSON-serializable. Every name/label is USER DATA; nothing here models a
 * trading methodology. See docs/IPC_CONTRACT.md.
 */

import type { IpcResult } from './result'

export type RuleKindDto = 'Required' | 'Optional' | 'Conditional'
export const RULE_KINDS: readonly RuleKindDto[] = ['Required', 'Optional', 'Conditional']

export interface RuleDto {
  id: string
  name: string
  description: string
  kind: RuleKindDto
}

export interface RuleGroupDto {
  id: string
  name: string
  rules: RuleDto[]
}

/** A published (frozen) version. `groups` are the exact groups/rules as published. */
export interface StrategyVersionDto {
  id: string
  number: number
  /** Epoch milliseconds (UTC). Formatting is a presentation concern. */
  publishedAt: number
  groups: RuleGroupDto[]
  /** Short rule-level summary derived from the previous version; not a diff engine. */
  changes: string[]
}

/** The one mutable working state of a Strategy. */
export interface StrategyDraftDto {
  id: string
  /** Number of the published version this draft was started from; null if never published. */
  basedOn: number | null
  groups: RuleGroupDto[]
}

export type StrategyStatusDto = 'Active' | 'Archived'

/** A Strategy aggregate: metadata, published versions (oldest first), and the optional Draft. */
export interface StrategyDto {
  id: string
  name: string
  description: string
  status: StrategyStatusDto
  versions: StrategyVersionDto[]
  draft: StrategyDraftDto | null
}

/** Intent-level edits to a Strategy's Draft. Each is applied atomically. */
export type DraftEdit =
  | { type: 'addGroup'; name: string }
  | { type: 'renameGroup'; groupId: string; name: string }
  | { type: 'deleteGroup'; groupId: string }
  | { type: 'moveGroup'; groupId: string; delta: -1 | 1 }
  | { type: 'addRule'; groupId: string; name: string; kind: RuleKindDto; description: string }
  | { type: 'updateRule'; ruleId: string; name: string; kind: RuleKindDto; description: string }
  | { type: 'deleteRule'; ruleId: string }
  | { type: 'moveRule'; ruleId: string; delta: -1 | 1 }

/** The Strategy operations the renderer may call. Nothing else is exposed. */
export interface StrategiesApi {
  /** Every strategy (active and archived) with its published versions and draft. */
  list(): Promise<IpcResult<StrategyDto[]>>
  /** Creates the Strategy and its initial (empty, unpublished) Draft. No version exists yet. */
  create(input: { name: string; description: string }): Promise<IpcResult<StrategyDto>>
  /** Name/description are metadata: never creates a Draft or Version. */
  updateDetails(input: { strategyId: string; name: string; description: string }): Promise<IpcResult<StrategyDto>>
  archive(strategyId: string): Promise<IpcResult<StrategyDto>>
  restore(strategyId: string): Promise<IpcResult<StrategyDto>>
  /** Only a never-published strategy can be deleted; strategies with history are archived instead. */
  deleteUnpublished(strategyId: string): Promise<IpcResult<null>>
  /** Starts the Draft from the current published version. */
  beginDraft(strategyId: string): Promise<IpcResult<StrategyDto>>
  discardDraft(strategyId: string): Promise<IpcResult<StrategyDto>>
  editDraft(input: { strategyId: string; edit: DraftEdit }): Promise<IpcResult<StrategyDto>>
  /** Validates and publishes the Draft as the next sequential version, transactionally. */
  publishDraft(strategyId: string): Promise<IpcResult<StrategyDto>>
}

/** Channel names. Main registers exactly these; preload invokes exactly these. */
export const STRATEGY_CHANNELS = {
  list: 'strategies:list',
  create: 'strategies:create',
  updateDetails: 'strategies:updateDetails',
  archive: 'strategies:archive',
  restore: 'strategies:restore',
  deleteUnpublished: 'strategies:deleteUnpublished',
  beginDraft: 'strategies:beginDraft',
  discardDraft: 'strategies:discardDraft',
  editDraft: 'strategies:editDraft',
  publishDraft: 'strategies:publishDraft'
} as const

export type StrategyChannel = (typeof STRATEGY_CHANNELS)[keyof typeof STRATEGY_CHANNELS]
