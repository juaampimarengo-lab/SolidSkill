import { RULE_KINDS } from '../../shared/ipc/strategies'
import type { DraftEdit, RuleKindDto } from '../../shared/ipc/strategies'
import { RULE_STATES } from '../../shared/ipc/trades'
import type { RuleStateDto, TradeListRequest } from '../../shared/ipc/trades'
import { MEDIA_STAGES, MEDIA_TIMEFRAMES } from '../../shared/ipc/media'
import type {
  AddDayMediaRequest,
  AddTradeMediaRequest,
  MediaStageDto,
  MediaTimeframeDto,
  SetFeaturedTradeMediaRequest
} from '../../shared/ipc/media'
import {
  SCORECARD_MAX_SCORE,
  SCORECARD_MIN_SCORE,
  SCORECARD_NOTE_MAX_LENGTH,
  WEEKLY_REFLECTION_FIELDS,
  WEEKLY_SCORECARD_DIMENSIONS
} from '../../shared/ipc/reviews'
import type {
  WeeklyReflectionField,
  WeeklyReflectionFieldsDto,
  WeeklyScorecardDimension,
  WeeklyScorecardEntryPatch
} from '../../shared/ipc/reviews'
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

// ---- Media payloads ---------------------------------------------------------

const MAX_CAPTION_INPUT = 500
const MAX_TOKEN = 200

function mediaTimeframe(value: unknown): MediaTimeframeDto {
  if (typeof value !== 'string' || !(MEDIA_TIMEFRAMES as readonly string[]).includes(value)) invalid('Timeframe is invalid')
  return value as MediaTimeframeDto
}

function mediaStage(value: unknown): MediaStageDto {
  if (typeof value !== 'string' || !(MEDIA_STAGES as readonly string[]).includes(value)) invalid('Stage is invalid')
  return value as MediaStageDto
}

function mediaCaption(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') invalid('Caption must be text')
  if (value.length > MAX_CAPTION_INPUT) invalid('Caption is too long')
  return value
}

function mediaToken(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TOKEN) invalid('Staged image token is invalid')
  return value
}

export function mediaTradeIdInput(payload: unknown): string {
  return id(payload, 'Trade id')
}

export function mediaDayInput(payload: unknown): { accountId: string; date: string } {
  return dayInput(payload)
}

export function addTradeMediaInput(payload: unknown): AddTradeMediaRequest {
  const p = record(payload, 'Request')
  return {
    tradeId: id(p['tradeId'], 'Trade id'),
    token: mediaToken(p['token']),
    timeframe: mediaTimeframe(p['timeframe']),
    stage: mediaStage(p['stage']),
    caption: mediaCaption(p['caption'])
  }
}

export function addDayMediaInput(payload: unknown): AddDayMediaRequest {
  const p = record(payload, 'Request')
  return {
    accountId: id(p['accountId'], 'Account id'),
    date: isoDate(p['date'], 'Date'),
    token: mediaToken(p['token']),
    timeframe: mediaTimeframe(p['timeframe']),
    stage: mediaStage(p['stage']),
    caption: mediaCaption(p['caption'])
  }
}

export function mediaIdInput(payload: unknown): string {
  return id(payload, 'Media id')
}

export function setFeaturedTradeMediaInput(payload: unknown): SetFeaturedTradeMediaRequest {
  const p = record(payload, 'Request')
  return { tradeId: id(p['tradeId'], 'Trade id'), mediaId: id(p['mediaId'], 'Media id') }
}

// ---- Weekly Review payloads -------------------------------------------------

export function weekInput(payload: unknown): { accountId: string; weekStart: string } {
  const p = record(payload, 'Request')
  return { accountId: id(p['accountId'], 'Account id'), weekStart: isoDate(p['weekStart'], 'Week start') }
}

/**
 * Authored reflection text is kept EXACTLY as typed (no trim), bounded like
 * notes. Only the known prompt fields are accepted; anything else is refused
 * rather than ignored, so a renderer bug can never write an unexpected column.
 */
export function saveWeekInput(payload: unknown): {
  accountId: string
  weekStart: string
  fields: Partial<WeeklyReflectionFieldsDto>
} {
  const p = record(payload, 'Request')
  const raw = record(p['fields'], 'Fields')
  const fields: Partial<WeeklyReflectionFieldsDto> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(WEEKLY_REFLECTION_FIELDS as readonly string[]).includes(key)) invalid(`Unknown review field: ${key}`)
    fields[key as WeeklyReflectionField] = noteBody(value)
  }
  if (Object.keys(fields).length === 0) invalid('Nothing to save')
  return { ...weekInput(p), fields }
}

/**
 * Scorecard entries: only the known dimensions; per dimension only `score`
 * (integer 1–5, or null to clear) and `note` (short text, kept exactly as
 * typed). Unknown keys are refused rather than ignored.
 */
export function saveScorecardInput(payload: unknown): {
  accountId: string
  weekStart: string
  entries: Partial<Record<WeeklyScorecardDimension, WeeklyScorecardEntryPatch>>
} {
  const p = record(payload, 'Request')
  const raw = record(p['entries'], 'Entries')
  const entries: Partial<Record<WeeklyScorecardDimension, WeeklyScorecardEntryPatch>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(WEEKLY_SCORECARD_DIMENSIONS as readonly string[]).includes(key)) invalid(`Unknown scorecard dimension: ${key}`)
    const entry = record(value, 'Scorecard entry')
    const patch: WeeklyScorecardEntryPatch = {}
    for (const [part, partValue] of Object.entries(entry)) {
      if (part === 'score') {
        if (
          partValue !== null &&
          (typeof partValue !== 'number' ||
            !Number.isInteger(partValue) ||
            partValue < SCORECARD_MIN_SCORE ||
            partValue > SCORECARD_MAX_SCORE)
        ) {
          invalid(`Score must be a whole number from ${SCORECARD_MIN_SCORE} to ${SCORECARD_MAX_SCORE}`)
        }
        patch.score = partValue as number | null
      } else if (part === 'note') {
        if (typeof partValue !== 'string') invalid('Scorecard note must be text')
        if (partValue.length > SCORECARD_NOTE_MAX_LENGTH) invalid('Scorecard note is too long')
        patch.note = partValue
      } else {
        invalid(`Unknown scorecard entry field: ${part}`)
      }
    }
    if (Object.keys(patch).length === 0) invalid('Nothing to save')
    entries[key as WeeklyScorecardDimension] = patch
  }
  if (Object.keys(entries).length === 0) invalid('Nothing to save')
  return { ...weekInput(p), entries }
}

export function accountIdInput(payload: unknown): string {
  return id(payload, 'Account id')
}
