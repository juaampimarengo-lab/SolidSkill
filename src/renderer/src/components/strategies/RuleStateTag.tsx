import type { JSX } from 'react'
import { Check, CircleDashed, Minus, X } from 'lucide-react'
import type { RuleState } from '@renderer/types/journal'
import { formatCompliance, type ComplianceSummary } from '@renderer/lib/compliance'
import styles from './RuleStateTag.module.css'

// The four per-rule evaluation states. UNREVIEWED is deliberately NOT
// styled with positive/negative colors and differs structurally from N/A:
//   N/A        — explicitly judged not applicable: solid, muted fill.
//   UNREVIEWED — not yet evaluated: dashed outline, no fill, hollow glyph.
const config: Record<RuleState, { label: string; className: string; title: string }> = {
  Pass: { label: 'PASS', className: styles.pass, title: 'Rule satisfied' },
  Fail: { label: 'FAIL', className: styles.fail, title: 'Rule not satisfied' },
  'N/A': { label: 'N/A', className: styles.na, title: 'Reviewed — explicitly not applicable to this trade' },
  Unreviewed: { label: 'UNREVIEWED', className: styles.unreviewed, title: 'Not yet evaluated' }
}

function Glyph({ state }: { state: RuleState }): JSX.Element {
  if (state === 'Pass') return <Check size={11} strokeWidth={2.25} />
  if (state === 'Fail') return <X size={11} strokeWidth={2.25} />
  if (state === 'N/A') return <Minus size={11} strokeWidth={2.25} />
  return <CircleDashed size={11} strokeWidth={2} />
}

export function RuleStateTag({ state }: { state: RuleState }): JSX.Element {
  const c = config[state]
  return (
    <span className={`${styles.tag} ${c.className}`} title={c.title}>
      <Glyph state={state} />
      {c.label}
    </span>
  )
}

// Compact PASS / FAIL / N/A / UNREVIEWED selector for one rule of one Trade.
// The selected segment uses the same visual language as RuleStateTag (dashed
// for UNREVIEWED, never a positive/negative hue). State labels are canonical
// terms and are not translated (docs/LOCALIZATION.md).
const controlOrder: RuleState[] = ['Pass', 'Fail', 'N/A', 'Unreviewed']

export function RuleStateControl({
  state,
  label,
  unreviewedLabel,
  disabled = false,
  onChange
}: {
  state: RuleState
  /** Accessible name of the whole control (e.g. "Evaluation of <rule>"). */
  label: string
  /** Accessible name of the reset-to-UNREVIEWED segment. */
  unreviewedLabel: string
  disabled?: boolean
  onChange: (next: RuleState) => void
}): JSX.Element {
  return (
    <span className={styles.control} role="radiogroup" aria-label={label}>
      {controlOrder.map((s) => {
        const c = config[s]
        const selected = s === state
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={s === 'Unreviewed' ? unreviewedLabel : c.label}
            title={s === 'Unreviewed' ? unreviewedLabel : c.title}
            data-state={s}
            disabled={disabled}
            className={selected ? `${styles.segment} ${c.className}` : styles.segment}
            onClick={() => {
              if (!selected) onChange(s)
            }}
          >
            {s === 'Unreviewed' ? <Glyph state={s} /> : c.label}
          </button>
        )
      })}
    </span>
  )
}

// Compliance % and review completeness are always shown as two separate
// facts so a partially-reviewed trade never reads as a complete verdict.
export function ComplianceReadout({
  summary,
  showBasis = false
}: {
  summary: ComplianceSummary
  showBasis?: boolean
}): JSX.Element {
  return (
    <span className={styles.readout}>
      <span className={`num ${styles.percent}`}>{formatCompliance(summary)}</span>
      {showBasis && summary.percent !== null && (
        <span className={styles.basis}>
          {summary.pass} of {summary.pass + summary.fail} evaluated
        </span>
      )}
    </span>
  )
}

export function ReviewTag({ summary }: { summary: ComplianceSummary }): JSX.Element {
  return summary.reviewComplete ? (
    <span className={styles.reviewComplete}>Review: Complete</span>
  ) : (
    <span className={styles.reviewIncomplete}>
      <CircleDashed size={11} strokeWidth={2} />
      Review: Incomplete
      <span className="num">
        {' '}
        {summary.reviewed}/{summary.total}
      </span>
    </span>
  )
}
