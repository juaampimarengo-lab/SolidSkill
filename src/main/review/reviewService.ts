import type { Database, EvaluationState, WeeklyReview, WeeklyScorecardEntry } from '../persistence'
import type {
  WeeklyDayFactsDto,
  WeeklyReflectionDto,
  WeeklyReflectionFieldsDto,
  WeeklyReviewDto,
  WeeklyReviewWeeksDto,
  WeeklyRuleResultDto,
  WeeklyScorecardDimension,
  WeeklyScorecardDto,
  WeeklyScorecardEntryPatch
} from '../../shared/ipc/reviews'
import { EMPTY_REFLECTION, WEEKLY_REFLECTION_FIELDS, WEEKLY_SCORECARD_DIMENSIONS, emptyScorecard } from '../../shared/ipc/reviews'
import type { RuleStateDto } from '../../shared/ipc/trades'
import { isWeekStart, weekDates, weekEndOf, weekStartOf } from '../../shared/week'
import { toMediaItemDto } from '../media/mediaService'
import { ServiceError } from '../serviceError'
import { toSummaryDto } from '../trading/tradingService'

const STATE_FROM_DB: Record<EvaluationState, RuleStateDto> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  'N/A': 'N/A',
  UNREVIEWED: 'Unreviewed'
}

function toReflectionDto(review: WeeklyReview | null): WeeklyReflectionDto {
  if (review === null) return { ...EMPTY_REFLECTION, forecastUpdatedAt: null, updatedAt: null }
  const fields = {} as WeeklyReflectionFieldsDto
  for (const field of WEEKLY_REFLECTION_FIELDS) fields[field] = review[field]
  return { ...fields, forecastUpdatedAt: review.forecastUpdatedAt, updatedAt: review.updatedAt }
}

/** Every known dimension, unrated ones filled in; stored rows of unknown keys are ignored. */
function toScorecardDto(entries: readonly WeeklyScorecardEntry[]): WeeklyScorecardDto {
  const card = emptyScorecard()
  for (const entry of entries) {
    if ((WEEKLY_SCORECARD_DIMENSIONS as readonly string[]).includes(entry.dimension)) {
      card[entry.dimension as WeeklyScorecardDimension] = { score: entry.score, note: entry.note }
    }
  }
  return card
}

/**
 * Review Engine application service (docs/ARCHITECTURE.md §6, Checkpoint 015).
 *
 * Reads the Trading Domain and the Strategy Engine's persisted evaluations for
 * one (account, week) and owns exactly one kind of write: the trader's
 * authored weekly reflection and self-assessment scorecard. It never writes a Trade, an execution, a Rule
 * evaluation, a note or a media row, and it computes no metric — the facts it
 * returns are summarized by the renderer's pure lib/weeklyReview.ts. No
 * Electron imports; tested directly by smoke:weekly-review.
 */
export class ReviewService {
  constructor(private readonly db: Database) {}

  getWeek(accountId: string, weekStart: string): WeeklyReviewDto {
    const { accounts, tradeReads, evaluations, media, weeklyReviews, weeklyScorecards } = this.db.repositories
    const account = accounts.getById(accountId)
    if (account === null) throw new ServiceError('NOT_FOUND', 'Account not found.')
    this.requireWeekStart(weekStart)
    const weekEnd = weekEndOf(weekStart)

    const trades = tradeReads.listSummaries({ accountId, fromDate: weekStart, toDate: weekEnd }).map(toSummaryDto)
    const ruleResults: WeeklyRuleResultDto[] = evaluations
      .listForAccountRange(accountId, weekStart, weekEnd)
      .map((e) => ({
        tradeId: e.tradeId,
        ruleId: e.ruleId,
        ruleName: e.ruleTitle,
        groupName: e.ruleGroupName,
        strategyId: e.strategyId,
        strategyName: e.strategyName,
        versionId: e.strategyVersionId,
        versionNumber: e.versionNumber,
        state: STATE_FROM_DB[e.state]
      }))
    const mediaRows = media.listForAccountRange(accountId, weekStart, weekEnd)
    const noteDates = new Set(tradeReads.listDaysWithNotes({ accountId }).map((d) => d.tradeDate))
    const days: WeeklyDayFactsDto[] = weekDates(weekStart).map((date) => ({
      date,
      hasDayNote: noteDates.has(date),
      dayMediaCount: mediaRows.filter((m) => m.ownerType === 'DAY' && m.analyticalDate === date).length
    }))

    return {
      account: { id: account.id, displayName: account.displayName, currency: account.currency, timezone: account.timezone },
      weekStart,
      weekEnd,
      trades,
      ruleResults,
      days,
      media: mediaRows.map(toMediaItemDto),
      reflection: toReflectionDto(weeklyReviews.get(accountId, weekStart)),
      scorecard: toScorecardDto(weeklyScorecards.list(accountId, weekStart))
    }
  }

  /** Upserts only the given authored fields. Text is stored exactly as typed. */
  saveWeek(accountId: string, weekStart: string, fields: Partial<WeeklyReflectionFieldsDto>): WeeklyReflectionDto {
    return this.db.transaction(() => {
      if (this.db.repositories.accounts.getById(accountId) === null) {
        throw new ServiceError('NOT_FOUND', 'Account not found.')
      }
      this.requireWeekStart(weekStart)
      return toReflectionDto(this.db.repositories.weeklyReviews.save(accountId, weekStart, fields))
    })
  }

  /**
   * Upserts only the given scorecard dimensions / parts. Never touches the
   * authored reflection (a separate table). Notes are stored exactly as typed.
   */
  saveScorecard(
    accountId: string,
    weekStart: string,
    entries: Partial<Record<WeeklyScorecardDimension, WeeklyScorecardEntryPatch>>
  ): WeeklyScorecardDto {
    return this.db.transaction(() => {
      if (this.db.repositories.accounts.getById(accountId) === null) {
        throw new ServiceError('NOT_FOUND', 'Account not found.')
      }
      this.requireWeekStart(weekStart)
      for (const key of Object.keys(entries)) {
        if (!(WEEKLY_SCORECARD_DIMENSIONS as readonly string[]).includes(key)) {
          throw new ServiceError('INVALID_INPUT', 'Unknown scorecard dimension.')
        }
      }
      const patches: Record<string, WeeklyScorecardEntryPatch> = {}
      for (const [key, patch] of Object.entries(entries)) if (patch !== undefined) patches[key] = patch
      return toScorecardDto(this.db.repositories.weeklyScorecards.save(accountId, weekStart, patches))
    })
  }

  listWeeks(accountId: string): WeeklyReviewWeeksDto {
    const { accounts, tradeReads, weeklyReviews, weeklyScorecards } = this.db.repositories
    if (accounts.getById(accountId) === null) throw new ServiceError('NOT_FOUND', 'Account not found.')
    const traded = [...new Set(tradeReads.listTradeDates(accountId).map(weekStartOf))].sort().reverse()
    const authored = new Set([...weeklyReviews.listAuthoredWeeks(accountId), ...weeklyScorecards.listAuthoredWeeks(accountId)])
    return { tradedWeeks: traded, authoredWeeks: [...authored].sort().reverse() }
  }

  private requireWeekStart(weekStart: string): void {
    if (!isWeekStart(weekStart)) {
      throw new ServiceError('INVALID_INPUT', 'The date is not the first day of a review week.')
    }
  }
}
