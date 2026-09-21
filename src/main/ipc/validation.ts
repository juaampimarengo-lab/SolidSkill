import { RULE_KINDS } from '../../shared/ipc/strategies'
import type { DraftEdit, RuleKindDto } from '../../shared/ipc/strategies'
import { RULE_STATES } from '../../shared/ipc/trades'
import type { RuleStateDto, TradeListRequest } from '../../shared/ipc/trades'
import { ServiceError } from '../serviceError'

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

// ---- Trading payloads -------------------------------------------------------

const MAX_NOTE = 20000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date in 'YYYY-MM-DD' form. Pure string/UTC math: no local-timezone conversion. */
function isoDate(value: unknown, what: string): string {
  if (typeof value !== 'string') invalid(`${what} must be a date`)
  const match = ISO_DATE.exec(value)
  if (match === null) invalid(`${what} must be a date`)
  const [, y, m, d] = match
  const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (probe.getUTCFullYear() !== Number(y) || probe.getUTCMonth() !== Number(m) - 1 || probe.getUTCDate() !== Number(d)) {
    invalid(`${what} is not a real date`)
  }
  return value
}

function noteBody(value: unknown): string {
  if (typeof value !== 'string') invalid('Note must be text')
  if (value.length > MAX_NOTE) invalid('Note is too long')
  return value
}

function ruleState(value: unknown): RuleStateDto {
  if (typeof value !== 'string' || !(RULE_STATES as readonly string[]).includes(value)) invalid('Rule state is invalid')
  return value as RuleStateDto
}

export function tradeId(payload: unknown): string {
  return id(payload, 'Trade id')
}

export function tradeListInput(payload: unknown): TradeListRequest {
  if (payload === undefined || payload === null) return {}
  const p = record(payload, 'Request')
  const request: TradeListRequest = {}
  if (p['accountId'] !== undefined) request.accountId = id(p['accountId'], 'Account id')
  if (p['fromDate'] !== undefined) request.fromDate = isoDate(p['fromDate'], 'From date')
  if (p['toDate'] !== undefined) request.toDate = isoDate(p['toDate'], 'To date')
  return request
}

export function dayInput(payload: unknown): { accountId: string; date: string } {
  const p = record(payload, 'Request')
  return { accountId: id(p['accountId'], 'Account id'), date: isoDate(p['date'], 'Date') }
}

export function tradeNoteInput(payload: unknown): { tradeId: string; body: string } {
  const p = record(payload, 'Request')
  return { tradeId: id(p['tradeId'], 'Trade id'), body: noteBody(p['body']) }
}

export function dayNoteInput(payload: unknown): { accountId: string; date: string; body: string } {
  const p = record(payload, 'Request')
  return { accountId: id(p['accountId'], 'Account id'), date: isoDate(p['date'], 'Date'), body: noteBody(p['body']) }
}

export function ruleEvaluationInput(payload: unknown): { tradeId: string; ruleId: string; state: RuleStateDto } {
  const p = record(payload, 'Request')
  return {
    tradeId: id(p['tradeId'], 'Trade id'),
    ruleId: id(p['ruleId'], 'Rule id'),
    state: ruleState(p['state'])
  }
}
