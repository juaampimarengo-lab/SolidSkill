import { useMemo, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Anchor,
  Award,
  BadgeCheck,
  CalendarCheck,
  CircleCheck,
  ClipboardCheck,
  Crosshair,
  FileCheck,
  Focus,
  Gauge,
  Hourglass,
  Scale,
  SearchCheck,
  ShieldCheck,
  Target,
  type LucideIcon
} from 'lucide-react'
import {
  SCORECARD_MAX_SCORE,
  SCORECARD_MIN_SCORE,
  SCORECARD_NOTE_MAX_LENGTH,
  WEEKLY_SCORECARD_DIMENSIONS,
  type WeeklyScorecardDimension
} from '@shared/ipc/reviews'
import type { UseAutosave } from '@renderer/hooks/useAutosave'
import {
  CONSISTENT_REVIEWER_WEEKS,
  computeWeekProgress,
  type Achievement,
  type AchievementId
} from '@renderer/lib/weeklyReview'
import type { TradeSummary } from '@renderer/types/journal'
import { ICON_SIZE_SM, ICON_STROKE, SectionHead } from './WeeklySections'
import styles from './WeeklyReview.module.css'

// Weekly Review status blocks: progress bars, achievements and the
// self-assessment scorecard. All numbers are derived (lib/weeklyReview.ts) or
// authored by the trader; nothing here reads P&L.

// Canonical rule-state vocabulary stays literal (docs/LOCALIZATION.md §1).
const PASS = 'PASS'
const FAIL = 'FAIL'
const NA = 'N/A'
const UNREVIEWED = 'UNREVIEWED'

/** Scorecard draft keys: `<dimension>:score` ('' | '1'…'5') and `<dimension>:note`. */
export type ScorecardKey = `${WeeklyScorecardDimension}:score` | `${WeeklyScorecardDimension}:note`
export type ScorecardDraft = UseAutosave<ScorecardKey>

// ---- progress --------------------------------------------------------------

function ProgressBar({
  id,
  label,
  ratio,
  percent,
  detail,
  title,
  tone
}: {
  id: string
  label: string
  /** 0–1, or null when undefined (drawn as an empty dashed track, value "—"). */
  ratio: number | null
  percent: number | null
  detail: ReactNode
  title: string
  tone: 'mid' | 'muted'
}): JSX.Element {
  const value = percent === null ? '—' : `${percent}%`
  return (
    <div className={styles.progress} data-progress={id} data-percent={percent ?? ''} title={title}>
      <div className={styles.progressTop}>
        <span className={styles.progressLabel}>{label}</span>
        <span className={`num ${styles.progressValue}`}>{value}</span>
      </div>
      <div
        className={ratio === null ? `${styles.progressTrack} ${styles.progressTrackUndefined}` : styles.progressTrack}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={value}
      >
        {ratio !== null && (
          <div
            className={tone === 'mid' ? styles.progressFill : `${styles.progressFill} ${styles.progressFillMuted}`}
            style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
          />
        )}
      </div>
      <span className={styles.progressDetail}>{detail}</span>
    </div>
  )
}

export function WeekProgressPanel({ trades }: { trades: readonly TradeSummary[] }): JSX.Element {
  const { t } = useTranslation('review')
  const pr = useMemo(() => computeWeekProgress(trades), [trades])
  const states = { pass: PASS, fail: FAIL, na: NA, unreviewed: UNREVIEWED }
  const hasStrategyTrades = pr.review.total - pr.review.noStrategy > 0

  const complianceDetail =
    pr.compliance.evaluated > 0
      ? t('progress.complianceCounts', { passCount: pr.compliance.pass, failCount: pr.compliance.fail, pass: PASS, fail: FAIL })
      : pr.review.total === 0
        ? t('progress.reviewEmpty')
        : hasStrategyTrades
          ? t('progress.complianceEmpty', { pass: PASS, fail: FAIL })
          : t('progress.complianceNoStrategy')

  const reviewDetail =
    pr.review.total === 0
      ? t('progress.reviewEmpty')
      : [
          t('progress.reviewCounts', { reviewed: pr.review.reviewed, total: pr.review.total }),
          pr.review.incomplete > 0 ? t('progress.reviewIncomplete', { count: pr.review.incomplete, unreviewed: UNREVIEWED }) : null,
          pr.review.noStrategy > 0 ? t('progress.reviewNoStrategy', { count: pr.review.noStrategy }) : null
        ]
          .filter((part) => part !== null)
          .join(' · ')

  return (
    <section className={styles.section} data-section="progress">
      <SectionHead icon={Gauge} title={t('section.progress')} />
      <p className={styles.hint}>{t('progress.hint')}</p>
      <div className={styles.progressList}>
        <ProgressBar
          id="compliance"
          label={t('progress.compliance')}
          ratio={pr.compliance.ratio}
          percent={pr.compliance.percent}
          detail={complianceDetail}
          title={t('progress.complianceFormula', states)}
          tone="mid"
        />
        <ProgressBar
          id="review"
          label={t('progress.review')}
          ratio={pr.review.ratio}
          percent={pr.review.percent}
          detail={reviewDetail}
          title={t('progress.reviewFormula')}
          tone="muted"
        />
      </div>
    </section>
  )
}

// ---- achievements ----------------------------------------------------------

const ACHIEVEMENT_ICONS: Record<AchievementId, LucideIcon> = {
  reviewComplete: CircleCheck,
  tradesReviewed: FileCheck,
  noRuleFails: ShieldCheck,
  cleanProcess: BadgeCheck,
  forecastCompleted: Target,
  consistentReviewer: CalendarCheck
}

export function AchievementsPanel({ achievements }: { achievements: readonly Achievement[] }): JSX.Element {
  const { t } = useTranslation('review')
  const earned = achievements.filter((a) => a.earned).length
  const vars = { pass: PASS, fail: FAIL, count: CONSISTENT_REVIEWER_WEEKS }
  return (
    <section className={styles.section} data-section="achievements">
      <SectionHead icon={Award} title={t('section.achievements')}>
        <span className={`num ${styles.hintInline}`} data-achievements-earned={earned}>
          {t('achievements.earnedCount', { earned, total: achievements.length })}
        </span>
      </SectionHead>
      <p className={styles.hint}>{t('achievements.hint')}</p>
      <ul className={styles.achievements}>
        {achievements.map(({ id, earned: isEarned }) => {
          const Icon = ACHIEVEMENT_ICONS[id]
          const status = isEarned ? t('achievements.earned') : t('achievements.notYet')
          return (
            <li
              key={id}
              className={isEarned ? `${styles.achievement} ${styles.achievementEarned}` : styles.achievement}
              data-achievement={id}
              data-earned={isEarned ? 'true' : 'false'}
              title={`${status} — ${t(`achievements.${id}.criteria`, vars)}`}
            >
              <Icon className={styles.achievementIcon} size={ICON_SIZE_SM} strokeWidth={ICON_STROKE} aria-hidden />
              <span className={styles.achievementLabel}>{t(`achievements.${id}.label`, vars)}</span>
              <span className={styles.srOnly}>{status}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---- scorecard -------------------------------------------------------------

const DIMENSION_ICONS: Record<WeeklyScorecardDimension, LucideIcon> = {
  discipline: Anchor,
  patience: Hourglass,
  risk_management: Scale,
  execution_quality: Crosshair,
  focus: Focus,
  review_quality: SearchCheck
}

const SCORES = Array.from({ length: SCORECARD_MAX_SCORE - SCORECARD_MIN_SCORE + 1 }, (_, i) => SCORECARD_MIN_SCORE + i)

export function Scorecard({ draft, saveIndicator }: { draft: ScorecardDraft; saveIndicator: ReactNode }): JSX.Element {
  const { t } = useTranslation('review')
  const rated = WEEKLY_SCORECARD_DIMENSIONS.filter((d) => draft.values[`${d}:score`] !== '').length
  return (
    <section className={styles.section} data-section="scorecard">
      <SectionHead icon={ClipboardCheck} title={t('section.scorecard')}>
        <span className={styles.headAside}>
          <span className={`num ${styles.hintInline}`} data-scorecard-rated={rated}>
            {t('scorecard.rated', { count: rated, total: WEEKLY_SCORECARD_DIMENSIONS.length })}
          </span>
          {saveIndicator}
        </span>
      </SectionHead>
      <p className={styles.hint}>{t('scorecard.hint')}</p>
      <ul className={styles.scorecard}>
        {WEEKLY_SCORECARD_DIMENSIONS.map((d) => {
          const Icon = DIMENSION_ICONS[d]
          const label = t(`scorecard.dimension.${d}.label`)
          const raw = draft.values[`${d}:score`]
          const current = raw === '' ? null : Number(raw)
          return (
            <li key={d} className={styles.scoreRow} data-dimension={d}>
              <span className={styles.scoreDim}>
                <Icon className={styles.scoreIcon} size={ICON_SIZE_SM} strokeWidth={ICON_STROKE} aria-hidden />
                <span className={styles.scoreDimText}>
                  <span className={styles.scoreLabel}>{label}</span>
                  <span className={styles.scoreHint}>{t(`scorecard.dimension.${d}.hint`)}</span>
                </span>
              </span>
              <span className={styles.scoreScale} role="group" aria-label={label} title={t('scorecard.clearHint')}>
                {SCORES.map((n) => {
                  const selected = current === n
                  const within = current !== null && n <= current
                  const classes = [styles.scoreStep]
                  if (within) classes.push(styles.scoreStepWithin)
                  if (selected) classes.push(styles.scoreStepSelected)
                  return (
                    <button
                      key={n}
                      type="button"
                      className={classes.join(' ')}
                      data-score={n}
                      aria-pressed={selected}
                      aria-label={t('scorecard.scoreAria', { dimension: label, score: n })}
                      onClick={() => {
                        // Selecting the current score again clears it. A click is a deliberate
                        // choice, so it is saved right away rather than after the typing debounce.
                        draft.setField(`${d}:score`, selected ? '' : String(n))
                        draft.flush()
                      }}
                    >
                      <span className="num">{n}</span>
                    </button>
                  )
                })}
              </span>
              <input
                type="text"
                className={styles.scoreNote}
                data-note={d}
                value={draft.values[`${d}:note`]}
                maxLength={SCORECARD_NOTE_MAX_LENGTH}
                placeholder={t('scorecard.notePlaceholder')}
                aria-label={`${label} — ${t('scorecard.notePlaceholder')}`}
                spellCheck
                onChange={(event) => draft.setField(`${d}:note`, event.target.value)}
                onBlur={draft.flush}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
