import { RULE_KINDS } from '../../shared/ipc/strategies'
import type { DraftEdit, RuleKindDto } from '../../shared/ipc/strategies'
import { ServiceError } from '../strategies/strategyService'

/**
 * Manual, dependency-free validation of untrusted renderer payloads. Anything
 * from IPC is `unknown` until it passes through here; failures become
 * INVALID_INPUT results, never thrown into the renderer.
 */

const MAX_ID = 100
const MAX_NAME = 200
const MAX_TEXT = 4000

function invalid(message: string): never {
  throw new ServiceError('INVALID_INPUT', message)
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(`${what} must be an object`)
  return value as Record<string, unknown>
}

export function id(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID) invalid(`${what} is invalid`)
  return value
}

function name(value: unknown, what: string): string {
  if (typeof value !== 'string') invalid(`${what} must be text`)
  const trimmed = value.trim()
  if (trimmed === '') invalid(`${what} is required`)
  if (trimmed.length > MAX_NAME) invalid(`${what} is too long`)
  return trimmed
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') invalid(`${what} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > MAX_TEXT) invalid(`${what} is too long`)
  return trimmed
}

function kind(value: unknown): RuleKindDto {
  if (typeof value !== 'string' || !(RULE_KINDS as readonly string[]).includes(value)) invalid('Rule kind is invalid')
  return value as RuleKindDto
}

function delta(value: unknown): -1 | 1 {
  if (value !== -1 && value !== 1) invalid('Move direction is invalid')
  return value
}

export function strategyId(payload: unknown): string {
  return id(payload, 'Strategy id')
}

export function createInput(payload: unknown): { name: string; description: string } {
  const p = record(payload, 'Request')
  return { name: name(p['name'], 'Name'), description: text(p['description'] ?? '', 'Description') }
}

export function updateDetailsInput(payload: unknown): { strategyId: string; name: string; description: string } {
  const p = record(payload, 'Request')
  return {
    strategyId: id(p['strategyId'], 'Strategy id'),
    name: name(p['name'], 'Name'),
    description: text(p['description'] ?? '', 'Description')
  }
}

export function editDraftInput(payload: unknown): { strategyId: string; edit: DraftEdit } {
  const p = record(payload, 'Request')
  const e = record(p['edit'], 'Edit')
  const strategy = id(p['strategyId'], 'Strategy id')
  switch (e['type']) {
    case 'addGroup':
      return { strategyId: strategy, edit: { type: 'addGroup', name: name(e['name'], 'Group name') } }
    case 'renameGroup':
      return {
        strategyId: strategy,
        edit: { type: 'renameGroup', groupId: id(e['groupId'], 'Group id'), name: name(e['name'], 'Group name') }
      }
    case 'deleteGroup':
      return { strategyId: strategy, edit: { type: 'deleteGroup', groupId: id(e['groupId'], 'Group id') } }
    case 'moveGroup':
      return {
        strategyId: strategy,
        edit: { type: 'moveGroup', groupId: id(e['groupId'], 'Group id'), delta: delta(e['delta']) }
      }
    case 'addRule':
      return {
        strategyId: strategy,
        edit: {
          type: 'addRule',
          groupId: id(e['groupId'], 'Group id'),
          name: name(e['name'], 'Rule name'),
          kind: kind(e['kind']),
          description: text(e['description'] ?? '', 'Rule description')
        }
      }
    case 'updateRule':
      return {
        strategyId: strategy,
        edit: {
          type: 'updateRule',
          ruleId: id(e['ruleId'], 'Rule id'),
          name: name(e['name'], 'Rule name'),
          kind: kind(e['kind']),
          description: text(e['description'] ?? '', 'Rule description')
        }
      }
    case 'deleteRule':
      return { strategyId: strategy, edit: { type: 'deleteRule', ruleId: id(e['ruleId'], 'Rule id') } }
    case 'moveRule':
      return {
        strategyId: strategy,
        edit: { type: 'moveRule', ruleId: id(e['ruleId'], 'Rule id'), delta: delta(e['delta']) }
      }
    default:
      return invalid('Unknown draft edit')
  }
}
