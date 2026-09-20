import type { JSX } from 'react'
import { formatCompliance, type ComplianceSummary } from '@renderer/lib/compliance'
import styles from './CompactCompliance.module.css'

// The one compact compliance readout used across the app: "80% · Incomplete".
// Percentage = PASS / (PASS + FAIL), or "—" when nothing is evaluated;
// Review is a separate fact (Complete only when nothing is UNREVIEWED).
// No categorical compliance classes exist — see docs/STRATEGY_BUILDER_SPEC.md §10.
export function CompactCompliance({ summary }: { summary: ComplianceSummary }): JSX.Element {
  return (
    <span
      className={styles.readout}
      title={`${summary.pass} pass · ${summary.fail} fail · ${summary.na} N/A · ${summary.unreviewed} unreviewed`}
    >
      <span className={`num ${styles.percent}`}>{formatCompliance(summary)}</span>
      <span className={styles.sep}>·</span>
      <span className={summary.reviewComplete ? styles.complete : styles.incomplete}>
        {summary.reviewComplete ? 'Complete' : 'Incomplete'}
      </span>
    </span>
  )
}
