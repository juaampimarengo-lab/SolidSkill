import type { JSX } from 'react'
import { recentTrades } from '@renderer/data/dummyData'
import { formatPrice, formatR, formatUsd } from '@renderer/lib/format'
import styles from './JournalPreview.module.css'

const complianceModifier: Record<string, string> = {
  Compliant: styles.badgePositive,
  Violation: styles.badgeNegative,
  Partial: styles.badgeWarning
}

export function JournalPreview(): JSX.Element {
  return (
    <section className={styles.widget}>
      <span className={styles.title}>Recent Trades</span>

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thLeft}>Time</th>
            <th className={styles.thLeft}>Instrument</th>
            <th className={styles.thLeft}>Side</th>
            <th className={styles.thRight}>Qty</th>
            <th className={styles.thRight}>Entry</th>
            <th className={styles.thRight}>Exit</th>
            <th className={styles.thRight}>Result</th>
            <th className={styles.thRight}>R</th>
            <th className={styles.thLeft}>Strategy</th>
            <th className={styles.thLeft}>Compliance</th>
          </tr>
        </thead>
        <tbody>
          {recentTrades.map((trade) => (
            <tr key={`${trade.time}-${trade.instrument}`} className={styles.row}>
              <td className={`num ${styles.tdLeft} ${styles.time}`}>{trade.time}</td>
              <td className={styles.tdLeft}>{trade.instrument}</td>
              <td className={styles.tdLeft}>{trade.side}</td>
              <td className={`num ${styles.tdRight}`}>{trade.qty}</td>
              <td className={`num ${styles.tdRight}`}>{formatPrice(trade.entry)}</td>
              <td className={`num ${styles.tdRight}`}>{formatPrice(trade.exit)}</td>
              <td
                className={`num ${styles.tdRight} ${
                  trade.outcome === 'break-even' ? 'num--neutral' : `num--${trade.outcome}`
                }`}
              >
                {formatUsd(trade.resultUsd)}
              </td>
              <td
                className={`num ${styles.tdRight} ${
                  trade.outcome === 'break-even' ? 'num--neutral' : `num--${trade.outcome}`
                }`}
              >
                {formatR(trade.r)}
              </td>
              <td className={styles.tdLeft}>{trade.strategy}</td>
              <td className={styles.tdLeft}>
                <span className={`${styles.badge} ${complianceModifier[trade.compliance]}`}>
                  {trade.compliance}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
