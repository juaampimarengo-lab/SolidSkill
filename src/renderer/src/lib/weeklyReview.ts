// Weekly Review derivation (Checkpoint 015, docs/WEEKLY_REVIEW.md §6–§8).
//
// Pure functions over the facts the main process returns for one
// (account, week). Nothing here is persisted, and nothing here reads a clock,
// the browser locale or a timestamp's date: days are the persisted analytical
// dates. It reuses the exact classification Calendar and Day Review use
// (tradeOutcome / aggregateDay / outcomeOfTotal) and the canonical compliance
// derivation (src/shared/compliance.ts), so the same Trade or day can never
// read differently here than on those screens.
//
// OUTCOME and PROCESS are computed by separate functions from separate inputs:
// no process metric ever reads P&L, and no outcome metric ever reads a rule
// state. Rule FAIL counts are factual tallies — this module makes no claim
// about what a FAIL "caused" (that is future Behavior Analytics).

import { addCounts, summarizeCounts, type ComplianceCounts, type ComplianceSummary } from '@shared/compliance'
import { WEEKLY_REFLECTION_FIELDS, WEEKLY_SCORECARD_DIMENSIONS } from '@shared/ipc/reviews'
import type { WeeklyDayFactsDto, WeeklyReflectionFieldsDto, WeeklyRuleResultDto, WeeklyScorecardDimension } from '@shared/ipc/reviews'
import { addDays, weekdayOf } from '@shared/week'
import { aggregateDay, outcomeOfTotal } from '@renderer/lib/dayAggregate'
import { decimalSign, divideDecimal, sumDecimals, sumDecimalsOrNull, toScaled, type Decimal } from '@renderer/lib/decimal'
import { tradeCosts, tradeOutcome } from '@renderer/lib/tradeView'
import type { CalendarOutcome } from '@renderer/types/calendar'
import type { Outcome, TradeSummary } from '@renderer/types/journal'

// ---- outcome ---------------------------------------------------------------

export interface WeeklyOutcomeMetrics {
  trades: number
  /** null when no Trade reported the figure — never an invented zero. */
  netPnl: Decimal | null
  grossPnl: Decimal | null
  costs: Decimal | null
  /** Classified exactly like Day Review / Calendar (tradeOutcome, incl. the break-even threshold). */
  winners: number
  losers: number
  breakEven: number
  /** winners / trades × 100 (same definition as Day Review); null with no Trades. */
  winRate: number | null
  /** Mean net P&L of the classified winners / losers; null when there are none. */
  avgWinner: Decimal | null
  avgLoser: Decimal | null
  /** Sum of positive net P&L and sum of negative net P&L (strict sign). */
  grossProfit: Decimal
  grossLoss: Decimal
  /** grossProfit / |grossLoss|; null when there is no loss (mathematically undefined). */
  profitFactor: number | null
  long: number
  short: number
  daysTraded: number
  /** Days classified by the day's total net P&L sign — the Calendar cell rule. */
  winningDays: number
  losingDays: number
  breakEvenDays: number
  /** R only from Trades that carry realized R. A missing R is never 0R. */
  tradesWithR: number
  totalR: Decimal | null
  avgR: Decimal | null
  /** Factual extremes by net P&L — not a judgement of process quality. */
  largestGain: TradeSummary | null
  largestLoss: TradeSummary | null
}

export function computeOutcomeMetrics(trades: readonly TradeSummary[]): WeeklyOutcomeMetrics {
  const agg = aggregateDay(trades)
  const winnersList = trades.filter((t) => tradeOutcome(t) === 'positive')
  const losersList = trades.filter((t) => tradeOutcome(t) === 'negative')
  const nets = trades.map((t) => t.netPnl).filter((n): n is Decimal => n !== null)
  const grossProfit = sumDecimals(nets.filter((n) => decimalSign(n) > 0))
  const grossLoss = sumDecimals(nets.filter((n) => decimalSign(n) < 0))
  const lossMagnitude = -toScaled(grossLoss)
  const profitFactor = lossMagnitude === 0n ? null : Number(toScaled(grossProfit)) / Number(lossMagnitude)

  const byDate = new Map<string, TradeSummary[]>()
  for (const t of trades) byDate.set(t.tradeDate, [...(byDate.get(t.tradeDate) ?? []), t])
  const dayOutcomes = [...byDate.values()].map((dayTrades) => outcomeOfTotal(sumDecimalsOrNull(dayTrades.map((t) => t.netPnl))))

  const withR = trades.map((t) => t.realizedR).filter((r): r is Decimal => r !== null)
  const totalR = withR.length === 0 ? null : sumDecimals(withR)

  let largestGain: TradeSummary | null = null
  let largestLoss: TradeSummary | null = null
  for (const t of trades) {
    if (t.netPnl === null) continue
    const sign = decimalSign(t.netPnl)
    if (sign > 0 && (largestGain === null || toScaled(t.netPnl) > toScaled(largestGain.netPnl as Decimal))) largestGain = t
    if (sign < 0 && (largestLoss === null || toScaled(t.netPnl) < toScaled(largestLoss.netPnl as Decimal))) largestLoss = t
  }

  return {
    trades: agg.trades,
    netPnl: agg.netPnl,
    grossPnl: agg.grossPnl,
    costs: sumDecimalsOrNull(trades.map(tradeCosts)),
    winners: agg.winners,
    losers: agg.losers,
    breakEven: agg.breakEven,
    winRate: agg.winRate,
    avgWinner: winnersList.length === 0 ? null : divideDecimal(sumDecimals(winnersList.map((t) => t.netPnl)), winnersList.length),
    avgLoser: losersList.length === 0 ? null : divideDecimal(sumDecimals(losersList.map((t) => t.netPnl)), losersList.length),
    grossProfit,
    grossLoss,
    profitFactor,
    long: trades.filter((t) => t.direction === 'Long').length,
    short: trades.filter((t) => t.direction === 'Short').length,
    daysTraded: byDate.size,
    winningDays: dayOutcomes.filter((o) => o === 'positive').length,
    losingDays: dayOutcomes.filter((o) => o === 'negative').length,
    breakEvenDays: dayOutcomes.filter((o) => o === 'break-even').length,
    tradesWithR: withR.length,
    totalR,
    avgR: totalR === null ? null : divideDecimal(totalR, withR.length),
    largestGain,
    largestLoss
  }
}

// ---- process ---------------------------------------------------------------

export interface ComplianceExtreme {
  trade: TradeSummary
  percent: number
}

export interface WeeklyProcessMetrics {
  trades: number
  withStrategy: number
  /** Trades with no Strategy association: not reviewable, never counted as FAIL or UNREVIEWED. */
  noStrategy: number
  /** Strategy Trades with every rule judged (no UNREVIEWED). */
  reviewed: number
  /** Strategy Trades with at least one UNREVIEWED rule. */
  unreviewed: number
  /** Review complete, no FAIL and at least one PASS. */
  fullyCompliant: number
  /** At least one recorded FAIL, whether or not the review is complete. */
  withFail: number
  /** Pooled rule-state counts of the week; percent = PASS / (PASS + FAIL). */
  pooled: ComplianceSummary
  /** Distinct Strategy Versions the week's Trades were evaluated against. */
  versions: number
  /** Factual extremes among Trades whose compliance is defined; ties keep the earliest Trade. */
  highestCompliance: ComplianceExtreme | null
  /** null when fewer than two Trades have a defined compliance (it would repeat the highest). */
  lowestCompliance: ComplianceExtreme | null
}

export function computeProcessMetrics(trades: readonly TradeSummary[]): WeeklyProcessMetrics {
  const strategyTrades = trades.filter((t) => t.strategy !== null)
  const summaries = strategyTrades.map((t) => ({ trade: t, summary: summarizeCounts(t.compliance) }))
  const defined = summaries.filter((s) => s.summary.percent !== null) as { trade: TradeSummary; summary: ComplianceSummary & { percent: number } }[]
  let highest: ComplianceExtreme | null = null
  let lowest: ComplianceExtreme | null = null
  for (const { trade, summary } of defined) {
    if (highest === null || summary.percent > highest.percent) highest = { trade, percent: summary.percent }
    if (lowest === null || summary.percent < lowest.percent) lowest = { trade, percent: summary.percent }
  }
  return {
    trades: trades.length,
    withStrategy: strategyTrades.length,
    noStrategy: trades.length - strategyTrades.length,
    reviewed: summaries.filter((s) => s.summary.total > 0 && s.summary.reviewComplete).length,
    unreviewed: summaries.filter((s) => s.summary.total === 0 || !s.summary.reviewComplete).length,
    fullyCompliant: summaries.filter((s) => s.summary.reviewComplete && s.summary.fail === 0 && s.summary.pass > 0).length,
    withFail: summaries.filter((s) => s.summary.fail > 0).length,
    pooled: summarizeCounts(addCounts(strategyTrades.map((t) => t.compliance))),
    versions: new Set(strategyTrades.map((t) => t.strategy?.versionId)).size,
    highestCompliance: highest,
    lowestCompliance: defined.length < 2 || lowest?.trade.id === highest?.trade.id ? null : lowest
  }
}

// ---- rule review -----------------------------------------------------------

export interface RuleReviewRow {
  ruleId: string
  ruleName: string
  groupName: string
  pass: number
  fail: number
  na: number
  unreviewed: number
  /** Trades on which this rule was recorded FAIL, chronological. */
  failedTradeIds: string[]
  /** Descriptive outcome tally of those failed Trades — context, not cause. */
  failedOutcomes: Record<Outcome, number>
}

/** One exact Strategy Version as it was evaluated this week. */
export interface RuleReviewVersion {
  strategyId: string
  strategyName: string
  versionId: string
  versionNumber: number
  trades: number
  rules: RuleReviewRow[]
}

/**
 * Factual per-rule tallies, grouped by the exact version each Trade was
 * evaluated against (a rule of v2 and its successor in v3 are different rows
 * and are never merged). Rule order is the version's own workflow order.
 */
export function computeRuleReview(
  ruleResults: readonly WeeklyRuleResultDto[],
  trades: readonly TradeSummary[]
): RuleReviewVersion[] {
  const outcomeById = new Map(trades.map((t) => [t.id, tradeOutcome(t)] as const))
  const versions: RuleReviewVersion[] = []
  for (const r of ruleResults) {
    let version = versions.find((v) => v.versionId === r.versionId)
    if (version === undefined) {
      version = {
        strategyId: r.strategyId,
        strategyName: r.strategyName,
        versionId: r.versionId,
        versionNumber: r.versionNumber,
        trades: 0,
        rules: []
      }
      versions.push(version)
    }
    let row = version.rules.find((x) => x.ruleId === r.ruleId)
    if (row === undefined) {
      row = {
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        groupName: r.groupName,
        pass: 0,
        fail: 0,
        na: 0,
        unreviewed: 0,
        failedTradeIds: [],
        failedOutcomes: { positive: 0, negative: 0, 'break-even': 0 }
      }
      version.rules.push(row)
    }
    if (r.state === 'Pass') row.pass += 1
    else if (r.state === 'Fail') {
      row.fail += 1
      row.failedTradeIds.push(r.tradeId)
      row.failedOutcomes[outcomeById.get(r.tradeId) ?? 'break-even'] += 1
    } else if (r.state === 'N/A') row.na += 1
    else row.unreviewed += 1
  }
  for (const version of versions) {
    version.trades = trades.filter((t) => t.strategy?.versionId === version.versionId).length
  }
  return versions
}

/** Rules with at least one FAIL this week, most FAILs first (ties keep workflow order). */
export function ruleViolations(versions: readonly RuleReviewVersion[]): (RuleReviewRow & { version: RuleReviewVersion })[] {
  return versions
    .flatMap((version) => version.rules.filter((r) => r.fail > 0).map((r) => ({ ...r, version })))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.fail - a.row.fail || a.index - b.index)
    .map(({ row }) => row)
}

// ---- daily breakdown -------------------------------------------------------

export interface WeeklyDaySummary {
  date: string
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  trades: number
  netPnl: Decimal | null
  outcome: CalendarOutcome
  /** Pooled rule states of the day's Strategy Trades; null when none has a Strategy. */
  compliance: ComplianceSummary | null
  hasDayNote: boolean
  dayMediaCount: number
}

export function computeDailyBreakdown(
  days: readonly WeeklyDayFactsDto[],
  trades: readonly TradeSummary[]
): WeeklyDaySummary[] {
  return days.map((day) => {
    const dayTrades = trades.filter((t) => t.tradeDate === day.date)
    const agg = aggregateDay(dayTrades)
    const withStrategy = dayTrades.filter((t) => t.strategy !== null)
    const counts: ComplianceCounts = addCounts(withStrategy.map((t) => t.compliance))
    return {
      date: day.date,
      weekday: weekdayOf(day.date),
      trades: agg.trades,
      netPnl: agg.netPnl,
      outcome: agg.outcome,
      compliance: withStrategy.length === 0 ? null : summarizeCounts(counts),
      hasDayNote: day.hasDayNote,
      dayMediaCount: day.dayMediaCount
    }
  })
}

// ---- progress bars ---------------------------------------------------------

export interface WeekProgress {
  /** Process Compliance = PASS / (PASS + FAIL), pooled; N/A and UNREVIEWED excluded. */
  compliance: {
    pass: number
    fail: number
    /** PASS + FAIL — the denominator. */
    evaluated: number
    /** Exact ratio 0–1 for the bar; null when nothing is evaluated (never drawn as 0% or 100%). */
    ratio: number | null
    /** Rounded percentage, the same number shown everywhere else (shared/compliance.ts). */
    percent: number | null
  }
  /** Review Completion = reviewed Trades / all Trades of the week. */
  review: {
    /** Strategy Trades with every rule judged (the Process section's "Reviewed" bucket). */
    reviewed: number
    total: number
    /** Strategy Trades still carrying an UNREVIEWED rule. */
    incomplete: number
    /** Trades with no Strategy: counted in the total, never as reviewed. */
    noStrategy: number
    ratio: number | null
    percent: number | null
  }
}

/**
 * The two Weekly Review progress bars. Reads only rule-state counts and
 * Strategy association — never P&L — and reuses computeProcessMetrics so the
 * bars can never disagree with the Process section.
 */
export function computeWeekProgress(trades: readonly TradeSummary[]): WeekProgress {
  const p = computeProcessMetrics(trades)
  const evaluated = p.pooled.pass + p.pooled.fail
  const reviewRatio = p.trades === 0 ? null : p.reviewed / p.trades
  return {
    compliance: {
      pass: p.pooled.pass,
      fail: p.pooled.fail,
      evaluated,
      ratio: evaluated === 0 ? null : p.pooled.pass / evaluated,
      percent: p.pooled.percent
    },
    review: {
      reviewed: p.reviewed,
      total: p.trades,
      incomplete: p.unreviewed,
      noStrategy: p.noStrategy,
      ratio: reviewRatio,
      percent: reviewRatio === null ? null : Math.round(reviewRatio * 100)
    }
  }
}

// ---- achievements ----------------------------------------------------------

export const ACHIEVEMENT_IDS = [
  'reviewComplete',
  'tradesReviewed',
  'noRuleFails',
  'cleanProcess',
  'forecastCompleted',
  'consistentReviewer'
] as const

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number]

export interface Achievement {
  id: AchievementId
  earned: boolean
}

/** Consecutive authored weeks (this one included) needed for "Consistent reviewer". */
export const CONSISTENT_REVIEWER_WEEKS = 4

export interface AchievementInput {
  weekStart: string
  trades: readonly TradeSummary[]
  /** The live authored text (the draft), so a chip reflects what is on screen. */
  reflection: Readonly<WeeklyReflectionFieldsDto>
  scorecard: Readonly<Record<WeeklyScorecardDimension, { score: number | null }>>
  /** Week starts with any authored review for this account (listWeeks). */
  authoredWeeks: readonly string[]
}

const written = (text: string): boolean => text.trim() !== ''

/**
 * Discrete, understated recognition derived from the week's persisted facts
 * and the authored review — never persisted, never an input to anything.
 *
 * Deliberately process-only: no achievement reads P&L, and none rewards
 * trading MORE (every trade-based one requires a condition to hold for all of
 * the week's Trades, so a single well-reviewed Trade qualifies as much as
 * twenty). Pure: the inputs are not mutated.
 */
export function computeAchievements(input: AchievementInput): Achievement[] {
  const p = computeProcessMetrics(input.trades)
  const r = input.reflection
  const scoredAll = WEEKLY_SCORECARD_DIMENSIONS.every((d) => input.scorecard[d].score !== null)
  const reflectionWritten = [r.wentWell, r.needsImprovement, r.nextWeekFocus].every(written)
  const authoredNow =
    WEEKLY_REFLECTION_FIELDS.some((f) => written(r[f])) || WEEKLY_SCORECARD_DIMENSIONS.some((d) => input.scorecard[d].score !== null)
  const authored = new Set(input.authoredWeeks)
  let streak = authoredNow ? 1 : 0
  if (authoredNow) {
    for (let w = addDays(input.weekStart, -7); authored.has(w); w = addDays(w, -7)) streak += 1
  }
  const earned: Record<AchievementId, boolean> = {
    // The weekly review document itself: every scorecard dimension rated and the core reflection written.
    reviewComplete: scoredAll && reflectionWritten,
    // Every Trade of the week has all its rules judged (No-Strategy Trades cannot be).
    tradesReviewed: p.trades > 0 && p.reviewed === p.trades,
    // Rules were judged and none was recorded FAIL.
    noRuleFails: p.pooled.pass + p.pooled.fail > 0 && p.pooled.fail === 0,
    // Every Trade reviewed, no FAIL, each with at least one PASS.
    cleanProcess: p.trades > 0 && p.fullyCompliant === p.trades,
    // Both halves of Forecast vs Actual written.
    forecastCompleted: written(r.forecast) && written(r.actual),
    consistentReviewer: streak >= CONSISTENT_REVIEWER_WEEKS
  }
  return ACHIEVEMENT_IDS.map((id) => ({ id, earned: earned[id] }))
}
