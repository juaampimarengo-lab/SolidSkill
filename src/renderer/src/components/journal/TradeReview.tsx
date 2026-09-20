import { useState, type JSX, type ReactNode } from 'react'
import { X, Maximize2 } from 'lucide-react'
import type { JournalTrade, RuleState } from '@renderer/types/journal'
import { formatPrice, formatR, formatUsd } from '@renderer/lib/format'
import { countEntries, countExits } from '@renderer/lib/journal'
import { summarizeRules, tradeSummary } from '@renderer/lib/compliance'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import { getSeedVersion } from '@renderer/data/strategyDummyData'
import { ComplianceReadout, ReviewTag, RuleStateTag } from '@renderer/components/strategies/RuleStateTag'
import styles from './TradeReview.module.css'

type Tab = 'Overview' | 'Executions' | 'Strategy' | 'Notes'
const tabs: Tab[] = ['Overview', 'Executions', 'Strategy', 'Notes']

// Accepts CalendarOutcome's superset too ('no-trade') so Day Review / Trade
// Review can reuse this for day-level aggregate outcomes, not just a single
// trade's outcome.
export function outcomeNumClass(outcome: JournalTrade['outcome'] | 'no-trade'): string {
  if (outcome === 'break-even' || outcome === 'no-trade') return 'num--neutral'
  return `num--${outcome}`
}

interface TradeReviewProps {
  trade: JournalTrade
  onClose: () => void
  // Present when this panel is the Journal's quick preview (Checkpoint 008)
  // — opens the same trade in the canonical, full-page Trade Review.
  // Absent when TradeReview is reused as a plain tabbed panel elsewhere.
  onOpenFull?: () => void
}

export function TradeReview({ trade, onClose, onOpenFull }: TradeReviewProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('Overview')

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.headerTitle}>
            <span className={styles.instrument}>{trade.instrument}</span>
            <span className={styles.direction}>{trade.direction}</span>
          </div>
          <div className={styles.headerMeta}>
            {trade.date} · {trade.openTime.slice(0, 5)} – {trade.closeTime.slice(0, 5)} · {trade.duration}
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
        <span className={`num ${styles.resultValue} ${outcomeNumClass(trade.outcome)}`}>
          {formatUsd(trade.netPnl)}
        </span>
        {trade.realizedR !== null && (
          <span className={`num ${styles.resultR} ${outcomeNumClass(trade.outcome)}`}>
            {formatR(trade.realizedR)}
          </span>
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
        {tab === 'Executions' && <ExecutionsTab trade={trade} />}
        {tab === 'Strategy' && <StrategyTab trade={trade} />}
        {tab === 'Notes' && <NotesTab trade={trade} />}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </div>
  )
}

export function OverviewTab({ trade }: { trade: JournalTrade }): JSX.Element {
  return (
    <div>
      <div className={styles.group}>
        <div className={styles.groupTitle}>Identity</div>
        <div className={styles.fieldGrid}>
          <Field label="Instrument" value={trade.instrument} />
          <Field label="Direction" value={trade.direction} />
          <Field label="Account" value={trade.account} />
          <Field label="Duration" value={trade.duration} />
          <Field label="Open time" value={trade.openTime} />
          <Field label="Close time" value={trade.closeTime} />
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Position</div>
        <div className={styles.fieldGrid}>
          <Field label="Avg Entry" value={formatPrice(trade.avgEntry)} />
          <Field label="Avg Exit" value={formatPrice(trade.avgExit)} />
          <Field label="Quantity" value={String(trade.qty)} />
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Result</div>
        <div className={styles.fieldGrid}>
          <Field label="Gross P&L" value={formatUsd(trade.grossPnl)} />
          <Field label="Fees / Commission" value={formatUsd(-trade.fees)} />
          <Field label="Net P&L" value={formatUsd(trade.netPnl)} />
          <Field label="Planned R" value={trade.plannedR === null ? 'Not available' : formatR(trade.plannedR)} />
          <Field label="Realized R" value={trade.realizedR === null ? 'Not available' : formatR(trade.realizedR)} />
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Process</div>
        <div className={styles.fieldGrid}>
          <Field label="Strategy" value={trade.strategy} />
          <Field label="Strategy version" value={trade.strategyVersion} />
          <Field label="Compliance" value={<CompactCompliance summary={tradeSummary(trade.complianceRules)} />} />
        </div>
      </div>
    </div>
  )
}

export function ExecutionsTab({ trade }: { trade: JournalTrade }): JSX.Element {
  const entries = countEntries(trade)
  const exits = countExits(trade)

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
          {trade.executions.map((execution) => (
            <tr key={execution.id} className={styles.execRow}>
              <td className={`num ${styles.execTdLeft}`}>{execution.time}</td>
              <td className={`${styles.execTdLeft} ${execution.side === 'BUY' ? styles.sideBuy : styles.sideSell}`}>
                {execution.side}
              </td>
              <td className={`num ${styles.execTdRight}`}>{execution.qty}</td>
              <td className={`num ${styles.execTdRight}`}>{formatPrice(execution.price)}</td>
              <td className={`num ${styles.execTdRight}`}>{formatUsd(-execution.fee)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface RuleRow {
  name: string
  state: RuleState
}

// Groups the trade's saved rule results by the group each rule belonged to
// in the trade's SAVED strategy version (the static fixture snapshot — never
// the live workspace session state, so editing/publishing a strategy can
// not change how a historical trade renders).
function groupSavedRules(trade: JournalTrade): { name: string; rules: RuleRow[] }[] {
  const saved = getSeedVersion(trade.strategy, trade.strategyVersion)
  const groups: { name: string; rules: RuleRow[] }[] = []
  for (const result of trade.complianceRules) {
    const groupName = saved?.groups.find((g) => g.rules.some((r) => r.name === result.name))?.name ?? 'Ungrouped'
    let group = groups.find((g) => g.name === groupName)
    if (!group) {
      group = { name: groupName, rules: [] }
      groups.push(group)
    }
    group.rules.push({ name: result.name, state: result.state })
  }
  return groups
}

export function StrategyTab({ trade }: { trade: JournalTrade }): JSX.Element {
  const summary = summarizeRules(trade.complianceRules.map((r) => r.state))
  const groups = groupSavedRules(trade)

  return (
    <div>
      <div className={styles.strategyHead}>
        <span className={styles.strategyName}>{trade.strategy}</span>
        <span className={styles.versionBadge}>{trade.strategyVersion}</span>
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

      {groups.map((group) => (
        <div key={group.name} className={styles.ruleGroup}>
          <div className={styles.ruleGroupTitle}>{group.name}</div>
          <div className={styles.ruleList}>
            {group.rules.map((rule) => (
              <div key={rule.name} className={styles.ruleRow}>
                <span className={styles.ruleName}>{rule.name}</span>
                <RuleStateTag state={rule.state} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function NotesTab({ trade }: { trade: JournalTrade }): JSX.Element {
  return (
    <div>
      <div className={styles.noteBlock}>
        <div className={styles.noteTitle}>Trade Notes</div>
        <p className={styles.noteText}>{trade.tradeNote}</p>
      </div>

      {trade.dayNote && (
        <div className={styles.noteBlock}>
          <div className={styles.noteTitle}>Day Notes</div>
          <p className={styles.noteText}>{trade.dayNote}</p>
        </div>
      )}
    </div>
  )
}
