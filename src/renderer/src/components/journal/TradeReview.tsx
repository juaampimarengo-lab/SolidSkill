import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Maximize2, Plus } from 'lucide-react'
import type { RuleState, TradeDetail, TradeSummary } from '@renderer/types/journal'
import { formatPrice, formatR, formatUsd } from '@renderer/lib/format'
import { summarizeCounts } from '@shared/compliance'
import { sumDecimalsOrNull } from '@renderer/lib/decimal'
import {
  clockTime,
  closeTimeLabel,
  complianceOf,
  countEntries,
  countExits,
  dateLabel,
  durationLabel,
  openTimeLabel,
  outcomeNumClass,
  strategyName,
  tradeCosts,
  tradeOutcome,
  versionLabel
} from '@renderer/lib/tradeView'
import { useTradeDetail, type Loadable } from '@renderer/hooks/useTrading'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import { DataStatus } from '@renderer/components/shared/DataStatus'
import { ComplianceReadout, ReviewTag, RuleStateControl, RuleStateTag } from '@renderer/components/strategies/RuleStateTag'
import { AssignStrategyModal } from './AssignStrategyModal'
import { TradeCharts } from './TradeCharts'
import styles from './TradeReview.module.css'

type Tab = 'Overview' | 'Executions' | 'Strategy' | 'Charts' | 'Notes'
const tabs: Tab[] = ['Overview', 'Executions', 'Strategy', 'Charts', 'Notes']

interface TradeReviewProps {
  trade: TradeSummary
  onClose: () => void
  // Present when this panel is the Journal's quick preview (Checkpoint 008)
  // — opens the same trade in the canonical, full-page Trade Review.
  // Absent when TradeReview is reused as a plain tabbed panel elsewhere.
  onOpenFull?: () => void
}

export function TradeReview({ trade, onClose, onOpenFull }: TradeReviewProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('Overview')
  // The list row carries the summary; executions, the exact strategy version
  // and the notes come from the persisted detail of this trade.
  const detail = useTradeDetail(trade.id)
  const outcome = tradeOutcome(trade)

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.headerTitle}>
            <span className={styles.instrument}>{trade.instrument}</span>
            <span className={styles.direction}>{trade.direction}</span>
          </div>
          <div className={styles.headerMeta}>
            {dateLabel(trade.tradeDate)} · {openTimeLabel(trade).slice(0, 5)} – {closeTimeLabel(trade).slice(0, 5)} ·{' '}
            {durationLabel(trade)}
          </div>
        </div>
        <div className={styles.headerActions}>
          {onOpenFull && (
            <button type="button" className={styles.openFullButton} onClick={onOpenFull}>
              <Maximize2 size={12} strokeWidth={1.75} />
              Open full review
            </button>
          )}
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close trade review">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className={styles.resultLine}>
        <span className={`num ${styles.resultValue} ${outcomeNumClass(outcome)}`}>
          {trade.netPnl === null ? '—' : formatUsd(trade.netPnl)}
        </span>
        {trade.realizedR !== null && (
          <span className={`num ${styles.resultR} ${outcomeNumClass(outcome)}`}>{formatR(trade.realizedR)}</span>
        )}
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Trade review sections">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {tab === 'Overview' && <OverviewTab trade={trade} />}
        {tab === 'Executions' && (
          <DetailGate state={detail.state} onRetry={detail.retry} render={(d) => <ExecutionsTab detail={d} />} />
        )}
        {tab === 'Strategy' && (
          <DetailGate state={detail.state} onRetry={detail.retry} render={(d) => <StrategyTab detail={d} />} />
        )}
        {tab === 'Charts' && <TradeCharts tradeId={trade.id} />}
        {tab === 'Notes' && (
          <DetailGate state={detail.state} onRetry={detail.retry} render={(d) => <NotesTab detail={d} />} />
        )}
      </div>
    </div>
  )
}

// Shows the restrained loading/error state until the trade's persisted detail is ready.
function DetailGate({
  state,
  onRetry,
  render
}: {
  state: Loadable<TradeDetail>
  onRetry: () => void
  render: (detail: TradeDetail) => JSX.Element
}): JSX.Element {
  if (state.status !== 'ready') return <DataStatus what="Trade details" state={state} onRetry={onRetry} />
  return render(state.data)
}

function Field({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </div>
  )
}

export function OverviewTab({ trade }: { trade: TradeSummary }): JSX.Element {
  const costs = tradeCosts(trade)
  return (
    <div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Identity</div>
        <div className={styles.fieldGrid}>
          <Field label="Instrument" value={trade.instrument} />
          <Field label="Direction" value={trade.direction} />
          <Field label="Account" value={trade.accountName} />
          <Field label="Duration" value={durationLabel(trade)} />
          <Field label="Open time" value={openTimeLabel(trade)} />
          <Field label="Close time" value={closeTimeLabel(trade)} />
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Position</div>
        <div className={styles.fieldGrid}>
          <Field label="Avg Entry" value={formatPrice(trade.avgEntry)} />
          <Field label="Avg Exit" value={trade.avgExit === null ? '—' : formatPrice(trade.avgExit)} />
          <Field label="Quantity" value={trade.quantity} />
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Result</div>
        <div className={styles.fieldGrid}>
          <Field label="Gross P&L" value={trade.grossPnl === null ? '—' : formatUsd(trade.grossPnl)} />
          <Field label="Fees / Commission" value={costs === null ? '—' : formatUsd(costs)} />
          <Field label="Net P&L" value={trade.netPnl === null ? '—' : formatUsd(trade.netPnl)} />
          <Field label="Planned R" value={trade.plannedR === null ? 'Not available' : formatR(trade.plannedR)} />
          <Field label="Realized R" value={trade.realizedR === null ? 'Not available' : formatR(trade.realizedR)} />
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Process</div>
        <div className={styles.fieldGrid}>
          <Field label="Strategy" value={strategyName(trade)} />
          <Field label="Strategy version" value={versionLabel(trade)} />
          <Field label="Compliance" value={<CompactCompliance summary={complianceOf(trade)} />} />
        </div>
      </div>
    </div>
  )
}

export function ExecutionsTab({ detail }: { detail: TradeDetail }): JSX.Element {
  const { trade, executions } = detail
  // Direction is the persisted fact; it is never read off the last execution.
  const entries = countEntries(executions, trade.direction)
  const exits = countExits(executions, trade.direction)

  return (
    <div>
      <div className={styles.execSummary}>
        <span>
          <span className={styles.execSummaryLabel}>Trade direction </span>
          <span className={styles.execSummaryValue}>{trade.direction.toUpperCase()}</span>
        </span>
        <span>
          <span className={styles.execSummaryLabel}>Entries </span>
          <span className={styles.execSummaryValue}>{entries}</span>
        </span>
        <span>
          <span className={styles.execSummaryLabel}>Exits </span>
          <span className={styles.execSummaryValue}>{exits}</span>
        </span>
      </div>

      <table className={styles.execTable}>
        <thead>
          <tr>
            <th className={`${styles.execTh} ${styles.execThLeft}`}>Time</th>
            <th className={`${styles.execTh} ${styles.execThLeft}`}>Side</th>
            <th className={`${styles.execTh} ${styles.execThRight}`}>Qty</th>
            <th className={`${styles.execTh} ${styles.execThRight}`}>Price</th>
            <th className={`${styles.execTh} ${styles.execThRight}`}>Fee</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => {
            const cost = sumDecimalsOrNull([execution.commission, execution.fees, execution.swap])
            return (
              <tr key={execution.id} className={styles.execRow}>
                <td className={`num ${styles.execTdLeft}`}>{clockTime(execution.executedAt, trade.timezone)}</td>
                <td className={`${styles.execTdLeft} ${execution.side === 'BUY' ? styles.sideBuy : styles.sideSell}`}>
                  {execution.side}
                </td>
                <td className={`num ${styles.execTdRight}`}>{execution.quantity}</td>
                <td className={`num ${styles.execTdRight}`}>{formatPrice(execution.price)}</td>
                <td className={`num ${styles.execTdRight}`}>{cost === null ? '—' : formatUsd(cost)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// The saved version at time of evaluation, read by its persisted id: the rule
// wording and grouping are those of the exact published version the trade was
// evaluated against — not the live Strategy, and not affected by a rename or a
// newer published version.
//
// With `onChanged` (canonical Trade Review) the tab is interactive: an
// unassigned Trade offers the one-time Assign Strategy action, and each rule
// can be judged through the existing updateRuleEvaluation path. Every write is
// followed by a re-read of the persisted detail — nothing is computed locally.
// Without it (Journal quick preview) the tab stays read-only.
export function StrategyTab({ detail, onChanged }: { detail: TradeDetail; onChanged?: () => void }): JSX.Element {
  const { t } = useTranslation('journal')
  const { trade, strategy } = detail
  const [assigning, setAssigning] = useState(false)
  // Rule states the main process has CONFIRMED saved, shown until the re-read detail arrives.
  const [saved, setSaved] = useState<Record<string, RuleState>>({})
  const [savingRule, setSavingRule] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  useEffect(() => setSaved({}), [detail])

  if (strategy === null) {
    return (
      <div>
        <div className={styles.versionNote}>{t('assign.notAssociated')}</div>
        {onChanged ? (
          <button type="button" className={styles.assignButton} onClick={() => setAssigning(true)}>
            <Plus size={12} strokeWidth={1.75} />
            {t('assign.action')}
          </button>
        ) : (
          <div className={styles.versionNote}>{t('assign.openFullToAssign')}</div>
        )}
        {assigning && onChanged && (
          <AssignStrategyModal
            tradeId={trade.id}
            onClose={() => setAssigning(false)}
            onAssigned={() => {
              setAssigning(false)
              onChanged()
            }}
          />
        )}
      </div>
    )
  }

  async function setRuleState(ruleId: string, state: RuleState): Promise<void> {
    const api = window.solidSkill?.trades
    if (!api || !onChanged) return
    setSavingRule(ruleId)
    setSaveError(null)
    try {
      const result = await api.updateRuleEvaluation({ tradeId: trade.id, ruleId, state })
      if (result.ok) {
        setSaved((s) => ({ ...s, [ruleId]: result.data.state }))
        onChanged()
      } else {
        setSaveError(result.error.message)
      }
    } catch {
      setSaveError(t('evaluation.saveFailed'))
    }
    setSavingRule(null)
  }

  const summary = summarizeCounts(trade.compliance)

  return (
    <div>
      <div className={styles.strategyHead}>
        <span className={styles.strategyName}>{strategy.strategyName}</span>
        <span className={styles.versionBadge}>v{strategy.versionNumber}</span>
      </div>
      <div className={styles.versionNote}>
        Saved version at time of evaluation — frozen. Not the current strategy definition.
      </div>

      <div className={styles.complianceRow}>
        <ComplianceReadout summary={summary} showBasis />
        <span className={styles.complianceLabel}>Compliance = PASS / (PASS + FAIL)</span>
      </div>
      <div className={styles.reviewLine}>
        <ReviewTag summary={summary} />
        <span className={styles.complianceLabel}>
          <span className="num">
            {summary.pass}P {summary.fail}F {summary.na}N/A {summary.unreviewed}U
          </span>
        </span>
      </div>

      {saveError && <div className={styles.saveError}>{saveError}</div>}

      {strategy.groups.map((group) => (
        <div key={group.groupId} className={styles.ruleGroup}>
          <div className={styles.ruleGroupTitle}>{group.name}</div>
          <div className={styles.ruleList}>
            {group.rules.map((rule) => (
              <div key={rule.ruleId} className={styles.ruleRow} data-rule-id={rule.ruleId}>
                <span className={styles.ruleName}>{rule.name}</span>
                {onChanged ? (
                  <RuleStateControl
                    state={saved[rule.ruleId] ?? rule.state}
                    label={t('evaluation.controlLabel', { rule: rule.name })}
                    unreviewedLabel={t('evaluation.setUnreviewed')}
                    disabled={savingRule !== null}
                    onChange={(next) => void setRuleState(rule.ruleId, next)}
                  />
                ) : (
                  <RuleStateTag state={rule.state} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function NotesTab({ detail }: { detail: TradeDetail }): JSX.Element {
  return (
    <div>
      <div className={styles.noteBlock}>
        <div className={styles.noteTitle}>Trade Notes</div>
        <p className={styles.noteText}>{detail.tradeNote || 'No trade notes recorded.'}</p>
      </div>

      {detail.dayNote && (
        <div className={styles.noteBlock}>
          <div className={styles.noteTitle}>Day Notes</div>
          <p className={styles.noteText}>{detail.dayNote}</p>
        </div>
      )}
    </div>
  )
}
