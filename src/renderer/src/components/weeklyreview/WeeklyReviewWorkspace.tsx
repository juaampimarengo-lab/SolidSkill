import { useEffect, useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, NotebookPen, Target } from 'lucide-react'
import type { AccountDto } from '@shared/ipc/trades'
import type {
  SaveWeeklyReflectionRequest,
  SaveWeeklyScorecardRequest,
  WeeklyReflectionFieldsDto,
  WeeklyReviewDto,
  WeeklyScorecardDimension,
  WeeklyScorecardEntryPatch
} from '@shared/ipc/reviews'
import { WEEKLY_REFLECTION_FIELDS, WEEKLY_SCORECARD_DIMENSIONS } from '@shared/ipc/reviews'
import { addDays, weekEndOf, weekStartOf } from '@shared/week'
import { todayIsoDate } from '@renderer/lib/calendar'
import { dateLabel, longDateLabel } from '@renderer/lib/tradeView'
import { useReviewWeeks, useWeeklyReview } from '@renderer/hooks/useWeeklyReview'
import { useAutosave } from '@renderer/hooks/useAutosave'
import { computeAchievements } from '@renderer/lib/weeklyReview'
import { DataStatus } from '@renderer/components/shared/DataStatus'
import {
  ChartStrip,
  DailyStrip,
  ForecastActual,
  OutcomeSummary,
  ProcessSummary,
  Reflection,
  RuleReview,
  SaveIndicator,
  SectionHead,
  WeekTrades
} from './WeeklySections'
import { AchievementsPanel, Scorecard, WeekProgressPanel, type ScorecardKey } from './WeeklyStatus'
import styles from './WeeklyReview.module.css'

interface WeeklyReviewWorkspaceProps {
  /** The active account (docs/ACTIVE_ACCOUNT.md). Weekly Review never mixes accounts. */
  account: AccountDto | null
  /** Bumped by App when an overlay (Day/Trade Review) closes, so indicators re-read silently. */
  revision: number
  onOpenDayReview: (date: string) => void
  onOpenTradeReview: (tradeId: string) => void
}

export function WeeklyReviewWorkspace({ account, ...rest }: WeeklyReviewWorkspaceProps): JSX.Element {
  const { t } = useTranslation('review')
  if (account === null) return <p className={styles.empty}>{t('noAccount')}</p>
  return <AccountWeeklyReview account={account} {...rest} />
}

function AccountWeeklyReview({
  account,
  revision,
  onOpenDayReview,
  onOpenTradeReview
}: WeeklyReviewWorkspaceProps & { account: AccountDto }): JSX.Element {
  const { t } = useTranslation('review')
  // "This week" is the only place a local clock is read (same rule as the
  // Calendar's today marker); the week boundaries themselves are pure
  // analytical-date arithmetic with the explicit Sunday start (shared/week.ts).
  const currentWeek = useMemo(() => weekStartOf(todayIsoDate()), [])
  const [weekStart, setWeekStart] = useState(currentWeek)
  const week = useWeeklyReview(account.id, weekStart)
  const weeks = useReviewWeeks(account.id)

  // Returning from Day / Trade Review: re-read silently so Day Note / chart
  // indicators and rule states reflect what was just edited there.
  const { refresh: refreshWeek } = week
  const { refresh: refreshWeeks } = weeks
  useEffect(() => {
    if (revision === 0) return
    refreshWeek()
    refreshWeeks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  const jumpOptions = useMemo(() => {
    if (weeks.state.status !== 'ready') return []
    const traded = new Set(weeks.state.data.tradedWeeks)
    const authored = new Set(weeks.state.data.authoredWeeks)
    return [...new Set([...traded, ...authored, currentWeek])]
      .sort()
      .reverse()
      .map((start) => ({ start, traded: traded.has(start), authored: authored.has(start) }))
  }, [weeks.state, currentWeek])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.weekNav}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label={t('week.previous')}
            title={t('week.previous')}
          >
            <ChevronLeft size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label={t('week.next')}
            title={t('week.next')}
          >
            <ChevronRight size={15} strokeWidth={1.75} />
          </button>
          <span className={`num ${styles.weekRange}`} data-week-start={weekStart}>
            {t('week.range', { start: dateLabel(weekStart), end: longDateLabel(weekEndOf(weekStart)) })}
          </span>
          <span className={styles.accountName}>{account.displayName}</span>
        </div>
        <div className={styles.headerRight}>
          {weekStart !== currentWeek && (
            <button type="button" className={styles.textButton} onClick={() => setWeekStart(currentWeek)}>
              {t('week.thisWeek')}
            </button>
          )}
          <select
            className={styles.select}
            aria-label={t('week.jumpTo')}
            value={jumpOptions.some((o) => o.start === weekStart) ? weekStart : ''}
            onChange={(event) => {
              if (event.target.value !== '') setWeekStart(event.target.value)
            }}
          >
            <option value="">{t('week.jumpTo')}</option>
            {jumpOptions.map((o) => (
              <option key={o.start} value={o.start}>
                {`${dateLabel(o.start)} – ${longDateLabel(weekEndOf(o.start))}`}
                {o.traded ? ` · ${t('week.hasTrades')}` : ''}
                {o.authored ? ` · ${t('week.hasReview')}` : ''}
              </option>
            ))}
          </select>
        </div>
      </header>
      <p className={styles.convention}>{t('week.convention')}</p>

      {week.state.status !== 'ready' ? (
        <DataStatus what={t('title')} state={week.state} onRetry={week.retry} />
      ) : week.state.data.weekStart !== weekStart || week.state.data.account.id !== account.id ? (
        <DataStatus what={t('title')} state={{ status: 'loading' }} />
      ) : (
        // Keyed by (account, week): the authored draft belongs to exactly one
        // review identity; switching weeks flushes and remounts it.
        <WeekReview
          key={`${account.id}:${weekStart}`}
          data={week.state.data}
          authoredWeeks={weeks.state.status === 'ready' ? weeks.state.data.authoredWeeks : []}
          onSaved={refreshWeeks}
          onOpenDayReview={onOpenDayReview}
          onOpenTradeReview={onOpenTradeReview}
        />
      )}
    </div>
  )
}

function WeekReview({
  data,
  authoredWeeks,
  onSaved,
  onOpenDayReview,
  onOpenTradeReview
}: {
  data: WeeklyReviewDto
  authoredWeeks: readonly string[]
  onSaved: () => void
  onOpenDayReview: (date: string) => void
  onOpenTradeReview: (tradeId: string) => void
}): JSX.Element {
  const { t } = useTranslation('review')
  // Both drafts are seeded once per (account, week); later silent re-reads never overwrite typing.
  const initial = useMemo(() => {
    const fields = {} as WeeklyReflectionFieldsDto
    for (const field of WEEKLY_REFLECTION_FIELDS) fields[field] = data.reflection[field]
    return fields
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const initialScorecard = useMemo(() => {
    const values = {} as Record<ScorecardKey, string>
    for (const d of WEEKLY_SCORECARD_DIMENSIONS) {
      const entry = data.scorecard[d]
      values[`${d}:score`] = entry.score === null ? '' : String(entry.score)
      values[`${d}:note`] = entry.note
    }
    return values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [forecastUpdatedAt, setForecastUpdatedAt] = useState(data.reflection.forecastUpdatedAt)
  const accountId = data.account.id
  const weekStart = data.weekStart
  const draft = useAutosave<keyof WeeklyReflectionFieldsDto>(initial, async (fields) => {
    const api = window.solidSkill?.reviews
    if (!api) return { ok: false, error: { code: 'INTERNAL', message: 'unavailable' } }
    const request: SaveWeeklyReflectionRequest = { accountId, weekStart, fields }
    const result = await api.saveWeek(request)
    if (result.ok) {
      setForecastUpdatedAt(result.data.forecastUpdatedAt)
      onSaved()
    }
    return result
  })
  // The scorecard has its own autosave (and its own table): a scorecard save can never
  // carry — or overwrite — reflection text, and vice versa.
  const scoreDraft = useAutosave<ScorecardKey>(initialScorecard, async (patch) => {
    const api = window.solidSkill?.reviews
    if (!api) return { ok: false, error: { code: 'INTERNAL', message: 'unavailable' } }
    const entries: Partial<Record<WeeklyScorecardDimension, WeeklyScorecardEntryPatch>> = {}
    for (const [key, value] of Object.entries(patch) as [ScorecardKey, string][]) {
      const [dimension, part] = key.split(':') as [WeeklyScorecardDimension, 'score' | 'note']
      const entry = (entries[dimension] ??= {})
      if (part === 'score') entry.score = value === '' ? null : Number(value)
      else entry.note = value
    }
    const request: SaveWeeklyScorecardRequest = { accountId, weekStart, entries }
    const result = await api.saveScorecard(request)
    if (result.ok) onSaved()
    return result
  })

  // Derived from the facts + what is on screen now; never persisted.
  const achievements = useMemo(() => {
    const scorecard = {} as Record<WeeklyScorecardDimension, { score: number | null }>
    for (const d of WEEKLY_SCORECARD_DIMENSIONS) {
      const raw = scoreDraft.values[`${d}:score`]
      scorecard[d] = { score: raw === '' ? null : Number(raw) }
    }
    return computeAchievements({ weekStart, trades: data.trades, reflection: draft.values, scorecard, authoredWeeks })
  }, [weekStart, data.trades, draft.values, scoreDraft.values, authoredWeeks])

  return (
    <div className={styles.sections}>
      <div className={styles.statusRow}>
        <WeekProgressPanel trades={data.trades} />
        <AchievementsPanel achievements={achievements} />
      </div>

      <div className={styles.summaryRow}>
        <OutcomeSummary trades={data.trades} />
        <ProcessSummary trades={data.trades} />
      </div>

      <section className={styles.section} data-section="forecast">
        <SectionHead icon={Target} title={t('section.forecastActual')}>
          <SaveIndicator status={draft.status} onRetry={draft.flush} />
        </SectionHead>
        <ForecastActual
          draft={draft}
          forecastUpdatedAt={forecastUpdatedAt}
          weekStart={data.weekStart}
          timezone={data.account.timezone}
        />
      </section>

      <DailyStrip data={data} onOpenDayReview={onOpenDayReview} />
      <RuleReview data={data} />
      <WeekTrades trades={data.trades} onOpenTradeReview={onOpenTradeReview} />
      <ChartStrip media={data.media} trades={data.trades} />

      <Scorecard draft={scoreDraft} saveIndicator={<SaveIndicator status={scoreDraft.status} onRetry={scoreDraft.flush} />} />

      <section className={styles.section} data-section="reflection">
        <SectionHead icon={NotebookPen} title={t('section.reflection')}>
          <SaveIndicator status={draft.status} onRetry={draft.flush} />
        </SectionHead>
        <Reflection draft={draft} />
      </section>
    </div>
  )
}
