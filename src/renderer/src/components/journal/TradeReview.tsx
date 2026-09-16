import { useState, type JSX } from 'react'
import { X, Check, XCircle, Minus } from 'lucide-react'
import type { JournalTrade, RuleState } from '@renderer/types/journal'
import { formatPrice, formatR, formatUsd } from '@renderer/lib/format'
import { countEntries, countExits, ruleCompliancePercent } from '@renderer/lib/journal'
import styles from './TradeReview.module.css'

type Tab = 'Overview' | 'Executions' | 'Strategy' | 'Notes'
const tabs: Tab[] = ['Overview', 'Executions', 'Strategy', 'Notes']

function outcomeNumClass(outcome: JournalTrade['outcome']): string {
  return outcome === 'break-even' ? 'num--neutral' : `num--${outcome}`
}

interface TradeReviewProps {
  trade: JournalTrade
  onClose: () => void
}

export function TradeReview({ trade, onClose }: TradeReviewProps): JSX.Element {
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
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close trade review">
          <X size={16} strokeWidth={1.75} />
        </button>
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

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </div>
  )
}

function OverviewTab({ trade }: { trade: JournalTrade }): JSX.Element {
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
          <Field label="Compliance" value={trade.compliance} />
        </div>
      </div>
    </div>
  )
}

function ExecutionsTab({ trade }: { trade: JournalTrade }): JSX.Element {
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

const ruleStateModifier: Record<RuleState, string> = {
  Pass: styles.rulePass,
  Fail: styles.ruleFail,
  'N/A': styles.ruleNa
}

function RuleGlyph({ state }: { state: RuleState }): JSX.Element {
  if (state === 'Pass') return <Check size={12} strokeWidth={2} />
  if (state === 'Fail') return <XCircle size={12} strokeWidth={2} />
  return <Minus size={12} strokeWidth={2} />
}

function StrategyTab({ trade }: { trade: JournalTrade }): JSX.Element {
  return (
    <div>
      <div className={styles.strategyHead}>
        <span className={styles.strategyName}>{trade.strategy}</span>
        <span className={styles.versionBadge}>{trade.strategyVersion}</span>
      </div>
      <div className={styles.versionNote}>Saved strategy version at time of evaluation — not the current version.</div>

      <div className={styles.complianceRow}>
        <span className={`num ${styles.complianceValue}`}>{ruleCompliancePercent(trade.complianceRules)}%</span>
        <span className={styles.complianceLabel}>rule compliance</span>
      </div>

      <div className={styles.ruleList}>
        {trade.complianceRules.map((rule) => (
          <div key={rule.name} className={styles.ruleRow}>
            <span className={styles.ruleName}>{rule.name}</span>
            <span className={`${styles.ruleState} ${ruleStateModifier[rule.state]}`}>
              <RuleGlyph state={rule.state} />
              {rule.state}
            </span>
          </div>
        ))}
      </div>
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
