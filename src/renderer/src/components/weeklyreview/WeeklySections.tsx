import { useMemo, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  FileText,
  Image as ImageIcon,
  ListChecks,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react'
import type { MediaItemDto } from '@shared/ipc/media'
import type { WeeklyReflectionFieldsDto, WeeklyReviewDto } from '@shared/ipc/reviews'
import type { UseAutosave, SaveStatus } from '@renderer/hooks/useAutosave'
import { formatCompliance } from '@renderer/lib/compliance'
import { outcomeOfTotal } from '@renderer/lib/dayAggregate'
import { formatPercent, formatR, formatUsd } from '@renderer/lib/format'
import { stageI18nKey, timeframeLabel } from '@renderer/lib/media'
import { dateLabel, openTimeLabel, outcomeNumClass } from '@renderer/lib/tradeView'
import {
  computeDailyBreakdown,
  computeOutcomeMetrics,
  computeProcessMetrics,
  computeRuleReview,
  ruleViolations
} from '@renderer/lib/weeklyReview'
import type { TradeSummary } from '@renderer/types/journal'
import { TradeTable } from '@renderer/components/journal/TradeTable'
import { TradeReview } from '@renderer/components/journal/TradeReview'
import { ChartLightbox } from '@renderer/components/journal/ChartLightbox'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import styles from './WeeklyReview.module.css'

// Canonical trading / rule-state vocabulary (docs/LOCALIZATION.md §1) is kept
// as literals here and injected into translated sentences by interpolation —
// it is never itself a translation resource.
const PASS = 'PASS'
const FAIL = 'FAIL'
const NA = 'N/A'
const UNREVIEWED = 'UNREVIEWED'

type Draft = UseAutosave<keyof WeeklyReflectionFieldsDto>

// One line-icon family (lucide), 14–15px, never filled, always paired with a text label.
export const ICON_SIZE = 15
export const ICON_SIZE_SM = 14
export const ICON_STROKE = 1.75

// ---- small building blocks -------------------------------------------------

export function SectionHead({
  icon: Icon,
  title,
  children
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div className={styles.sectionHead}>
      <h2 className={styles.sectionTitle}>
        <Icon className={styles.sectionIcon} size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
        {title}
      </h2>
      {children}
    </div>
  )
}

export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }): JSX.Element {
  const { t } = useTranslation('review')
  return (
    <span className={status === 'error' ? `${styles.saveState} ${styles.saveError}` : styles.saveState} data-save-status={status} role="status">
      {t(`save.${status}`)}
      {status === 'error' && (
        <button type="button" className={styles.textButton} onClick={onRetry}>
          {t('save.retry')}
        </button>
      )}
    </span>
  )
}

function Metric({
  label,
  value,
  numClass,
  title,
  sub
}: {
  label: string
  value: string
  numClass?: string
  title?: string
  sub?: ReactNode
}): JSX.Element {
  return (
    <div className={styles.metric} title={title}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`num ${styles.metricValue} ${numClass ?? ''}`}>{value}</span>
      {sub !== undefined && <span className={styles.metricSub}>{sub}</span>}
    </div>
  )
}

function tradeRef(trade: TradeSummary): string {
  return `${trade.instrument} · ${dateLabel(trade.tradeDate)} ${openTimeLabel(trade).slice(0, 5)}`
}

function AuthoredField({
  draft,
  field,
  label,
  hint,
  placeholder,
  rows = 4
}: {
  draft: Draft
  field: keyof WeeklyReflectionFieldsDto
  label: string
  hint?: string
  placeholder: string
  rows?: number
}): JSX.Element {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {hint !== undefined && <span className={styles.fieldHint}>{hint}</span>}
      <textarea
        className={styles.textarea}
        data-field={field}
        rows={rows}
        value={draft.values[field]}
        placeholder={placeholder}
        spellCheck
        onChange={(event) => draft.setField(field, event.target.value)}
        onBlur={draft.flush}
      />
    </label>
  )
}

// ---- 2. outcome ------------------------------------------------------------

export function OutcomeSummary({ trades }: { trades: readonly TradeSummary[] }): JSX.Element {
  const { t } = useTranslation('review')
  const m = useMemo(() => computeOutcomeMetrics(trades), [trades])
  const usd = (v: string | null): string => (v === null ? '—' : formatUsd(v))
  return (
    <section className={styles.section} data-section="outcome">
      <SectionHead icon={BarChart3} title={t('section.outcome')} />
      <p className={styles.hint}>{t('outcome.hint')}</p>
      <div className={styles.metricGrid}>
        <Metric label="Net P&L" value={usd(m.netPnl)} numClass={m.netPnl === null ? '' : outcomeNumClass(m.trades === 0 ? 'no-trade' : outcomeOfTotal(m.netPnl))} />
        <Metric label="Trades" value={String(m.trades)} />
        <Metric label="Win Rate" value={m.winRate === null ? '—' : formatPercent(m.winRate)} sub={`${m.winners}W · ${m.losers}L · ${m.breakEven}BE`} />
        <Metric
          label="Profit Factor"
          value={m.profitFactor === null ? '—' : m.profitFactor.toFixed(2)}
          title={m.profitFactor === null && m.trades > 0 ? t('outcome.profitFactorUndefined') : `${formatUsd(m.grossProfit)} / ${formatUsd(m.grossLoss)}`}
        />
        <Metric label={t('outcome.avgWinner')} value={usd(m.avgWinner)} numClass={m.avgWinner === null ? '' : 'num--positive'} />
        <Metric label={t('outcome.avgLoser')} value={usd(m.avgLoser)} numClass={m.avgLoser === null ? '' : 'num--negative'} />
        <Metric label="Long / Short" value={`${m.long} / ${m.short}`} />
        <Metric label="Gross P&L" value={usd(m.grossPnl)} />
        <Metric label={t('outcome.costs')} value={usd(m.costs)} />
        <Metric label={t('outcome.daysTraded')} value={String(m.daysTraded)} sub={`${m.winningDays} ▲ · ${m.losingDays} ▼ · ${m.breakEvenDays} =`} title={`${t('outcome.winningDays')} · ${t('outcome.losingDays')} · ${t('outcome.flatDays')}`} />
        <Metric
          label="R"
          value={m.totalR === null ? '—' : formatR(m.totalR)}
          sub={m.tradesWithR === 0 ? t('outcome.rMissing', { rLabel: 'R' }) : `${t('outcome.rCoverage', { rLabel: 'R', count: m.tradesWithR, total: m.trades })} · ${t('outcome.avgR', { value: formatR(m.avgR as string) })}`}
        />
      </div>
      <div className={styles.extremes}>
        <span className={styles.extremeLabel}>{t('outcome.largestGain')}</span>
        <span className={`num ${m.largestGain ? 'num--positive' : ''}`}>
          {m.largestGain ? `${usd(m.largestGain.netPnl)} · ${tradeRef(m.largestGain)}` : t('outcome.none')}
        </span>
        <span className={styles.extremeLabel}>{t('outcome.largestLoss')}</span>
        <span className={`num ${m.largestLoss ? 'num--negative' : ''}`}>
          {m.largestLoss ? `${usd(m.largestLoss.netPnl)} · ${tradeRef(m.largestLoss)}` : t('outcome.none')}
        </span>
      </div>
    </section>
  )
}

// ---- 3. process ------------------------------------------------------------

export function ProcessSummary({ trades }: { trades: readonly TradeSummary[] }): JSX.Element {
  const { t } = useTranslation('review')
  const p = useMemo(() => computeProcessMetrics(trades), [trades])
  const states = { pass: PASS, fail: FAIL, na: NA, unreviewed: UNREVIEWED }
  return (
    <section className={styles.section} data-section="process">
      <SectionHead icon={ShieldCheck} title={t('section.process')} />
      <p className={styles.hint}>{t('process.hint')}</p>
      <div className={styles.metricGrid}>
        <Metric label={t('process.compliance')} value={formatCompliance(p.pooled)} />
        <Metric
          label={t('process.reviewCompleteness')}
          value={p.pooled.total === 0 ? '—' : `${Math.round((p.pooled.reviewed / p.pooled.total) * 100)}%`}
          sub={t('process.ruleChecks', { reviewed: p.pooled.reviewed, total: p.pooled.total })}
        />
        <Metric label={PASS} value={String(p.pooled.pass)} numClass={p.pooled.pass > 0 ? 'num--positive' : ''} />
        <Metric label={FAIL} value={String(p.pooled.fail)} numClass={p.pooled.fail > 0 ? 'num--negative' : ''} />
        <Metric label={NA} value={String(p.pooled.na)} />
        <Metric label={UNREVIEWED} value={String(p.pooled.unreviewed)} />
        <Metric label={t('process.reviewed')} value={`${p.reviewed}`} sub="Trades" />
        <Metric label={t('process.unreviewed')} value={`${p.unreviewed}`} sub="Trades" />
        <Metric label={t('process.noStrategy')} value={`${p.noStrategy}`} sub="Trades" />
        <Metric label={t('process.fullyCompliant')} value={`${p.fullyCompliant}`} sub="Trades" />
        <Metric label={t('process.withFail', { fail: FAIL })} value={`${p.withFail}`} sub="Trades" />
        <Metric label={t('process.versions')} value={String(p.versions)} />
      </div>
      {p.trades > 0 && p.withStrategy === 0 && <p className={styles.notice}>{t('process.emptyNoStrategy')}</p>}
      {p.withStrategy > 0 && p.pooled.evaluated === 0 && (
        <p className={styles.notice}>{t('process.emptyUnreviewed', { pass: PASS, fail: FAIL })}</p>
      )}
      {p.withStrategy > 0 && p.noStrategy > 0 && <p className={styles.hint}>{t('process.excludedNoStrategy', { count: p.noStrategy })}</p>}
      {(p.highestCompliance !== null || p.lowestCompliance !== null) && (
        <div className={styles.extremes}>
          {p.highestCompliance && (
            <>
              <span className={styles.extremeLabel}>{t('process.highestCompliance')}</span>
              <span className="num">{`${p.highestCompliance.percent}% · ${tradeRef(p.highestCompliance.trade)}`}</span>
            </>
          )}
          {p.lowestCompliance && (
            <>
              <span className={styles.extremeLabel}>{t('process.lowestCompliance')}</span>
              <span className="num">{`${p.lowestCompliance.percent}% · ${tradeRef(p.lowestCompliance.trade)}`}</span>
            </>
          )}
        </div>
      )}
      <p className={styles.footnote}>{t('process.formula', states)}</p>
    </section>
  )
}

// ---- 4. forecast vs actual -------------------------------------------------

/** 'YYYY-MM-DD' of an instant in the account's timezone (UTC when unknown). */
function accountDate(epochMs: number, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(epochMs)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(epochMs)
  }
}

export function ForecastActual({
  draft,
  forecastUpdatedAt,
  weekStart,
  timezone
}: {
  draft: Draft
  forecastUpdatedAt: number | null
  weekStart: string
  timezone: string | null
}): JSX.Element {
  const { t } = useTranslation('review')
  const editedOn = forecastUpdatedAt === null ? null : accountDate(forecastUpdatedAt, timezone)
  return (
    <>
      <div className={styles.twoCol}>
        <div>
          <AuthoredField
            draft={draft}
            field="forecast"
            label={t('forecast.forecast')}
            hint={t('forecast.forecastHint')}
            placeholder={t('forecast.forecastPlaceholder')}
            rows={5}
          />
          {editedOn !== null && (
            <p className={styles.footnote} data-forecast-edited={editedOn}>
              {t('forecast.lastEdited', { date: dateLabel(editedOn) })}
              {editedOn >= weekStart ? ` — ${t('forecast.editedDuringWeek')}` : ''}
            </p>
          )}
        </div>
        <AuthoredField
          draft={draft}
          field="actual"
          label={t('forecast.actual')}
          hint={t('forecast.actualHint')}
          placeholder={t('forecast.actualPlaceholder')}
          rows={5}
        />
      </div>
    </>
  )
}

// ---- 5. daily breakdown ----------------------------------------------------

export function DailyStrip({
  data,
  onOpenDayReview
}: {
  data: WeeklyReviewDto
  onOpenDayReview: (date: string) => void
}): JSX.Element {
  const { t } = useTranslation('review')
  const days = useMemo(() => computeDailyBreakdown(data.days, data.trades), [data.days, data.trades])
  return (
    <section className={styles.section} data-section="daily">
      <SectionHead icon={CalendarDays} title={t('section.daily')} />
      <div className={styles.dayStrip}>
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={styles.dayCell}
            data-date={day.date}
            onClick={() => onOpenDayReview(day.date)}
            aria-label={t('daily.open', { date: dateLabel(day.date) })}
            title={t('daily.open', { date: dateLabel(day.date) })}
          >
            <span className={styles.dayHead}>
              <span className={styles.dayName}>{t(`daily.weekday.${day.weekday}`)}</span>
              <span className={`num ${styles.dayDate}`}>{dateLabel(day.date)}</span>
            </span>
            {day.trades === 0 ? (
              <span className={styles.dayEmpty}>{t('daily.noTrades')}</span>
            ) : (
              <>
                <span className={`num ${styles.dayPnl} ${outcomeNumClass(day.outcome)}`}>
                  {day.netPnl === null ? '—' : formatUsd(day.netPnl)}
                </span>
                <span className={styles.dayMeta}>
                  <span className="num">{day.trades}</span> {day.trades === 1 ? 'Trade' : 'Trades'}
                </span>
                <span className={styles.dayMeta}>
                  {day.compliance === null ? t('daily.noStrategy') : <CompactCompliance summary={day.compliance} />}
                </span>
              </>
            )}
            <span className={styles.dayIcons}>
              {day.hasDayNote && (
                <span className={styles.indicator} title={t('daily.dayNote')} data-indicator="note">
                  <FileText size={12} strokeWidth={1.75} />
                </span>
              )}
              {day.dayMediaCount > 0 && (
                <span className={styles.indicator} title={t('daily.dayCharts')} data-indicator="charts">
                  <ImageIcon size={12} strokeWidth={1.75} />
                  <span className="num">{day.dayMediaCount}</span>
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ---- 6. rule review --------------------------------------------------------

export function RuleReview({ data }: { data: WeeklyReviewDto }): JSX.Element {
  const { t } = useTranslation('review')
  const versions = useMemo(() => computeRuleReview(data.ruleResults, data.trades), [data.ruleResults, data.trades])
  const violations = useMemo(() => ruleViolations(versions), [versions])
  return (
    <section className={styles.section} data-section="rules">
      <SectionHead icon={ListChecks} title={t('section.rules')} />
      <p className={styles.hint}>{t('rules.hint')}</p>
      {versions.length === 0 ? (
        <p className={styles.empty}>{t('rules.noEvaluations')}</p>
      ) : (
        <>
          <div className={styles.subTitle}>{t('rules.violations')}</div>
          {violations.length === 0 ? (
            <p className={styles.emptyInline}>{t('rules.noViolations', { fail: FAIL })}</p>
          ) : (
            <ul className={styles.violations}>
              {violations.map((v) => (
                <li key={v.ruleId} className={styles.violation} data-rule-id={v.ruleId}>
                  <span className={styles.violationRule}>{v.ruleName}</span>
                  <span className={styles.violationVersion}>
                    {v.version.strategyName} <span className="num">v{v.version.versionNumber}</span>
                  </span>
                  <span className={`num ${styles.violationCount}`}>{t('rules.failedOn', { fail: FAIL, count: v.failedTradeIds.length })}</span>
                  <span className={styles.violationOutcomes}>
                    {t('rules.failedOutcomes', {
                      positive: v.failedOutcomes.positive,
                      negative: v.failedOutcomes.negative,
                      flat: v.failedOutcomes['break-even']
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.footnote}>{t('rules.disclaimer')}</p>

          {versions.map((version) => (
            <div key={version.versionId} className={styles.versionBlock} data-version-id={version.versionId}>
              <div className={styles.versionHead}>
                <span className={styles.versionName}>
                  {version.strategyName} <span className="num">v{version.versionNumber}</span>
                </span>
                <span className={styles.hintInline}>{t('rules.versionTrades', { count: version.trades })}</span>
              </div>
              <table className={styles.ruleTable}>
                <thead>
                  <tr>
                    <th className={styles.thLeft}>{t('rules.rule')}</th>
                    <th className={styles.thLeft}>{t('rules.group')}</th>
                    <th className={styles.thRight}>{PASS}</th>
                    <th className={styles.thRight}>{FAIL}</th>
                    <th className={styles.thRight}>{NA}</th>
                    <th className={styles.thRight}>{UNREVIEWED}</th>
                  </tr>
                </thead>
                <tbody>
                  {version.rules.map((rule) => (
                    <tr key={rule.ruleId}>
                      <td className={styles.tdLeft}>{rule.ruleName}</td>
                      <td className={`${styles.tdLeft} ${styles.muted}`}>{rule.groupName}</td>
                      <td className={`num ${styles.tdRight}`}>{rule.pass}</td>
                      <td className={`num ${styles.tdRight} ${rule.fail > 0 ? 'num--negative' : ''}`}>{rule.fail}</td>
                      <td className={`num ${styles.tdRight}`}>{rule.na}</td>
                      <td className={`num ${styles.tdRight} ${styles.muted}`}>{rule.unreviewed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

// ---- 7. trades -------------------------------------------------------------

export function WeekTrades({
  trades,
  onOpenTradeReview
}: {
  trades: readonly TradeSummary[]
  onOpenTradeReview: (tradeId: string) => void
}): JSX.Element {
  const { t } = useTranslation('review')
  // Same interaction as the Journal: click selects + quick inspect, double-click / Enter / the
  // panel's "Open full review" go through App's single openTradeReview navigation.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = trades.find((trade) => trade.id === selectedId) ?? null
  return (
    <section className={styles.section} data-section="trades">
      <SectionHead icon={ArrowLeftRight} title={t('section.trades')}>
        <span className={styles.hintInline}>{t('trades.hint')}</span>
      </SectionHead>
      {trades.length === 0 ? (
        <p className={styles.empty}>{t('trades.empty')}</p>
      ) : (
        <div className={selected ? `${styles.tradesBody} ${styles.tradesBodyInspecting}` : styles.tradesBody}>
          <div className={styles.tradesTable}>
            <TradeTable trades={trades} selectedId={selectedId} onSelect={setSelectedId} onOpenFull={onOpenTradeReview} />
          </div>
          {selected && (
            <div className={styles.quickPanel}>
              <TradeReview trade={selected} onClose={() => setSelectedId(null)} onOpenFull={() => onOpenTradeReview(selected.id)} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---- chart evidence --------------------------------------------------------

export function ChartStrip({ media, trades }: { media: readonly MediaItemDto[]; trades: readonly TradeSummary[] }): JSX.Element {
  const { t } = useTranslation('review')
  const { t: tj } = useTranslation('journal')
  const [preview, setPreview] = useState<MediaItemDto | null>(null)
  const tradeById = useMemo(() => new Map(trades.map((trade) => [trade.id, trade] as const)), [trades])
  return (
    <section className={styles.section} data-section="charts">
      <SectionHead icon={ImageIcon} title={t('section.charts')}>
        <span className={styles.hintInline}>{t('charts.hint')}</span>
      </SectionHead>
      {media.length === 0 ? (
        <p className={styles.empty}>{t('charts.empty')}</p>
      ) : (
        <div className={styles.chartStrip}>
          {media.map((item) => {
            const trade = item.tradeId === null ? undefined : tradeById.get(item.tradeId)
            const owner =
              item.ownerType === 'DAY'
                ? `${t('charts.dayOwner')} · ${dateLabel(item.analyticalDate ?? '')}`
                : trade
                  ? `${trade.instrument} · ${dateLabel(trade.tradeDate)}`
                  : t('charts.tradeOwner')
            return (
              <button key={item.id} type="button" className={styles.chartTile} data-media-id={item.id} onClick={() => setPreview(item)}>
                <img className={styles.chartThumb} src={item.url} alt="" />
                <span className={styles.chartMeta}>
                  <span>{owner}</span>
                  <span className={styles.muted}>
                    {timeframeLabel(item.timeframe) || tj('timeframe.other')} · {tj(stageI18nKey(item.stage))}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
      {preview && <ChartLightbox item={preview} onClose={() => setPreview(null)} />}
    </section>
  )
}

// ---- 8. reflection ---------------------------------------------------------

export function Reflection({ draft }: { draft: Draft }): JSX.Element {
  const { t } = useTranslation('review')
  const fields: (keyof WeeklyReflectionFieldsDto)[] = [
    'wentWell',
    'needsImprovement',
    'repeatNextWeek',
    'avoidNextWeek',
    'nextWeekFocus',
    'notes'
  ]
  return (
    <div className={styles.reflectionGrid}>
      {fields.map((field) => (
        <AuthoredField
          key={field}
          draft={draft}
          field={field}
          label={t(`reflection.${field}`)}
          placeholder={t(`reflection.${field}Placeholder`)}
        />
      ))}
    </div>
  )
}
