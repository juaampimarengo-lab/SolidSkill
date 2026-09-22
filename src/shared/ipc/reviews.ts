/**
 * Weekly Review IPC contract (Checkpoint 015, docs/WEEKLY_REVIEW.md).
 *
 * The main process returns FACTS for one (account, week): the week's persisted
 * Trade summaries, every Rule evaluation of those Trades read through each
 * Trade's exact Strategy Version, Day Note / Chart Evidence indicators, and
 * the trader's authored reflection. Every metric (P&L, Win Rate, compliance,
 * Rule FAIL counts …) is derived from these facts by the renderer's pure
 * `lib/weeklyReview.ts` — the same classification Calendar and Day Review use
 * — and is never persisted.
 *
 * Authored text crosses exactly as typed: never trimmed, never translated.
 */

import type { MediaItemDto } from './media'
import type { IpcResult } from './result'
import type { AccountDto, RuleStateDto, TradeSummaryDto } from './trades'

/** The authored prompts of a Weekly Review. '' = not written. */
export interface WeeklyReflectionFieldsDto {
  forecast: string
  actual: string
  wentWell: string
  needsImprovement: string
  repeatNextWeek: string
  avoidNextWeek: string
  nextWeekFocus: string
  notes: string
}

export type WeeklyReflectionField = keyof WeeklyReflectionFieldsDto

export const WEEKLY_REFLECTION_FIELDS: readonly WeeklyReflectionField[] = [
  'forecast',
  'actual',
  'wentWell',
  'needsImprovement',
  'repeatNextWeek',
  'avoidNextWeek',
  'nextWeekFocus',
  'notes'
]

export const EMPTY_REFLECTION: WeeklyReflectionFieldsDto = {
  forecast: '',
  actual: '',
  wentWell: '',
  needsImprovement: '',
  repeatNextWeek: '',
  avoidNextWeek: '',
  nextWeekFocus: '',
  notes: ''
}

/**
 * Weekly Scorecard (migration 005): the trader's own 1–5 self-assessment of
 * the week on a fixed set of generic process dimensions. These are NOT
 * trading-methodology concepts (no setup, pattern or market model is implied)
 * — they describe how the trader conducted themselves, whatever their
 * Strategy. Stored identifiers are stable keys; labels are localized.
 */
export const WEEKLY_SCORECARD_DIMENSIONS = [
  'discipline',
  'patience',
  'risk_management',
  'execution_quality',
  'focus',
  'review_quality'
] as const

export type WeeklyScorecardDimension = (typeof WEEKLY_SCORECARD_DIMENSIONS)[number]

export const SCORECARD_MIN_SCORE = 1
export const SCORECARD_MAX_SCORE = 5
/** A scorecard note is a short comment, not a journal entry. */
export const SCORECARD_NOTE_MAX_LENGTH = 500

export interface WeeklyScorecardEntryDto {
  /** 1–5, or null when not rated. */
  score: number | null
  /** Exactly as typed; '' = no note. */
  note: string
}

export type WeeklyScorecardDto = Record<WeeklyScorecardDimension, WeeklyScorecardEntryDto>

export interface WeeklyScorecardEntryPatch {
  /** Present to change the score; null clears it. */
  score?: number | null
  /** Present to change the note. */
  note?: string
}

export function emptyScorecard(): WeeklyScorecardDto {
  const card = {} as WeeklyScorecardDto
  for (const d of WEEKLY_SCORECARD_DIMENSIONS) card[d] = { score: null, note: '' }
  return card
}

export interface WeeklyReflectionDto extends WeeklyReflectionFieldsDto {
  /** Epoch ms the forecast text last changed; null when never written. */
  forecastUpdatedAt: number | null
  /** Epoch ms of the last save; null when nothing has been saved for this week. */
  updatedAt: number | null
}

/**
 * One Rule evaluation of one Trade in the week, with the wording of the EXACT
 * Strategy Version that Trade was evaluated against. The same logical rule in
 * two versions has two different `ruleId`s and is reported separately.
 */
export interface WeeklyRuleResultDto {
  tradeId: string
  ruleId: string
  ruleName: string
  groupName: string
  strategyId: string
  /** The Strategy's CURRENT display name (user data). */
  strategyName: string
  versionId: string
  versionNumber: number
  state: RuleStateDto
}

export interface WeeklyDayFactsDto {
  /** Analytical date 'YYYY-MM-DD'. */
  date: string
  hasDayNote: boolean
  /** Number of Day-level Chart Evidence items for this date. */
  dayMediaCount: number
}

export interface WeeklyReviewDto {
  account: AccountDto
  /** Canonical week start (src/shared/week.ts) and inclusive end, 'YYYY-MM-DD'. */
  weekStart: string
  weekEnd: string
  /** This account's Trades with an analytical date in the week, chronological. */
  trades: TradeSummaryDto[]
  ruleResults: WeeklyRuleResultDto[]
  /** Exactly the 7 dates of the week, in order. */
  days: WeeklyDayFactsDto[]
  /** Day Chart Evidence of the week + the featured chart of each of the week's Trades (read-only reuse). */
  media: MediaItemDto[]
  reflection: WeeklyReflectionDto
  /** Every dimension is present; unrated ones are { score: null, note: '' }. */
  scorecard: WeeklyScorecardDto
}

export interface WeeklyReviewWeeksDto {
  /** Week starts that have Trades for this account, newest first. */
  tradedWeeks: string[]
  /** Week starts that have any authored reflection text or scorecard entry, newest first. */
  authoredWeeks: string[]
}

export interface WeekRequest {
  accountId: string
  /** Must be a canonical week start (src/shared/week.ts). */
  weekStart: string
}

export interface SaveWeeklyReflectionRequest extends WeekRequest {
  /** Only the fields being saved; absent fields keep their stored text. */
  fields: Partial<WeeklyReflectionFieldsDto>
}

export interface SaveWeeklyScorecardRequest extends WeekRequest {
  /** Only the dimensions / parts being saved; everything absent keeps its stored value. */
  entries: Partial<Record<WeeklyScorecardDimension, WeeklyScorecardEntryPatch>>
}

/** Weekly Review operations. Nothing here writes a Trade, an execution or an evaluation. */
export interface ReviewsApi {
  getWeek(request: WeekRequest): Promise<IpcResult<WeeklyReviewDto>>
  saveWeek(request: SaveWeeklyReflectionRequest): Promise<IpcResult<WeeklyReflectionDto>>
  saveScorecard(request: SaveWeeklyScorecardRequest): Promise<IpcResult<WeeklyScorecardDto>>
  listWeeks(accountId: string): Promise<IpcResult<WeeklyReviewWeeksDto>>
}

export const REVIEW_CHANNELS = {
  getWeek: 'reviews:getWeek',
  saveWeek: 'reviews:saveWeek',
  saveScorecard: 'reviews:saveScorecard',
  listWeeks: 'reviews:listWeeks'
} as const

export type ReviewChannel = (typeof REVIEW_CHANNELS)[keyof typeof REVIEW_CHANNELS]
