import { useState, type JSX } from 'react'
import type { Strategy } from '@renderer/types/strategy'
import { currentVersion, ruleCount } from '@renderer/lib/strategyDraft'
import { tradesForStrategy } from '@renderer/lib/strategyTrades'
import { ReadOnlyGroups } from './ReadOnlyGroups'
import styles from './Strategies.module.css'

export function VersionsTab({ strategy }: { strategy: Strategy }): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null)
  const current = currentVersion(strategy)
  const trades = tradesForStrategy(strategy)

  if (!current) {
    return (
      <div className={styles.empty}>
        No published versions yet. The first Publish creates v1 — no empty version is created before that.
      </div>
    )
  }

  const shown = strategy.versions.find((v) => v.number === (selected ?? current.number)) ?? current
  const ordered = strategy.versions.slice().reverse()
  const tradeCount = (n: number): number => trades.filter((r) => r.trade.strategyVersion === `v${n}`).length

  return (
    <div className={styles.versionsLayout}>
      <div className={styles.versionList}>
        {strategy.draft && (
          <div className={`${styles.versionRow} ${styles.versionRowDraft}`}>
            <span className={`num ${styles.versionNum}`}>Draft</span>
            <span className={styles.versionMeta}>
              {strategy.draft.basedOn !== null ? `based on v${strategy.draft.basedOn}` : 'unpublished'} · not a version
            </span>
          </div>
        )}
        {ordered.map((v) => (
          <button
            key={v.number}
            type="button"
            className={
              v.number === shown.number ? `${styles.versionRow} ${styles.versionRowActive}` : styles.versionRow
            }
            onClick={() => setSelected(v.number)}
          >
            <span className={`num ${styles.versionNum}`}>v{v.number}</span>
            <span className={styles.versionState}>{v.number === current.number ? 'Current' : 'Historical'}</span>
            <span className={styles.versionMeta}>{v.publishedOn}</span>
          </button>
        ))}
      </div>

      <div className={styles.versionDetail}>
        <div className={styles.versionDetailHead}>
          <span className={`num ${styles.versionTitle}`}>v{shown.number}</span>
          <span className={styles.versionState}>
            {shown.number === current.number ? 'Current published' : 'Historical'} · frozen, read-only
          </span>
        </div>
        <div className={styles.versionFacts}>
          <span>Published {shown.publishedOn}</span>
          <span>{shown.groups.length} groups</span>
          <span>{ruleCount(shown.groups)} rules</span>
          <span>{tradeCount(shown.number)} trades on this version</span>
        </div>

        <div className={styles.blockTitle}>Changes in this version</div>
        <ul className={styles.changeList}>
          {shown.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>

        <div className={styles.blockTitle}>Structure as published</div>
        <ReadOnlyGroups groups={shown.groups} />
      </div>
    </div>
  )
}
