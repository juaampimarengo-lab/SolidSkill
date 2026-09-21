import { useState, type JSX } from 'react'
import type { Strategy } from '@renderer/types/strategy'
import type { RuleState, TradeSummary } from '@renderer/types/journal'
import { summarizeRules } from '@renderer/lib/compliance'
import { formatUsd } from '@renderer/lib/format'
import { currentVersion, ruleCount } from '@renderer/lib/strategyDraft'
import { aggregateStrategyTrades, sampleLabel, tradesForStrategy } from '@renderer/lib/strategyTrades'
import { ComplianceReadout, ReviewTag, RuleStateTag } from './RuleStateTag'
import styles from './Strategies.module.css'

// Illustrative fixture states cycled over the current version's rules so the
// four-state model is visible. NOT a real trade and not editable.
const exampleStates: RuleState[] = ['Pass', 'Fail', 'N/A', 'Unreviewed']

interface OverviewTabProps {
  strategy: Strategy
  trades: readonly TradeSummary[]
  // Persists name/description immediately (no Draft, no Version). Resolves true on success.
  onSaveDetails: (name: string, description: string) => Promise<boolean>
  // Lower-cased names of the OTHER strategies, for the uniqueness check.
  otherNames: string[]
}

export function OverviewTab({ strategy, trades, onSaveDetails, otherNames }: OverviewTabProps): JSX.Element {
  const [editingDetails, setEditingDetails] = useState(false)
  const version = currentVersion(strategy)
  const shownGroups = version?.groups ?? strategy.draft?.groups ?? []
  const rows = tradesForStrategy(strategy.id, trades)
  const agg = aggregateStrategyTrades(rows)

  const exampleRules = version ? version.groups.flatMap((g) => g.rules) : []
  const example = exampleRules.map((rule, i) => ({ rule, state: exampleStates[i % exampleStates.length] as RuleState }))
  const exampleSummary = summarizeRules(example.map((e) => e.state))

  return (
    <div className={styles.overviewGrid}>
      <section>
        <div className={styles.blockTitle}>
          Definition
          {!editingDetails && strategy.status === 'Active' && (
            <button type="button" className={styles.buttonSecondary} onClick={() => setEditingDetails(true)}>
              Edit details
            </button>
          )}
        </div>
        {editingDetails ? (
          <DetailsForm
            strategy={strategy}
            otherNames={otherNames}
            onSave={async (name, description) => {
              if (await onSaveDetails(name, description)) setEditingDetails(false)
            }}
            onCancel={() => setEditingDetails(false)}
          />
        ) : null}
        <dl className={styles.facts}>
          {!editingDetails && (
            <>
              <dt>Name</dt>
              <dd>{strategy.name}</dd>
              <dt>Description</dt>
              <dd>{strategy.description || '—'}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>{strategy.status}</dd>
          <dt>Published version</dt>
          <dd className="num">{version ? `v${version.number}` : 'None yet'}</dd>
          <dt>Rule groups</dt>
          <dd className="num">
            {shownGroups.length}
            {!version && ' (draft)'}
          </dd>
          <dt>Rules</dt>
          <dd className="num">
            {ruleCount(shownGroups)}
            {!version && ' (draft)'}
          </dd>
          <dt>Trades associated</dt>
          <dd className="num">{agg.tradeCount}</dd>
        </dl>
        <div className={styles.staticNote}>
          Name and description are saved directly. They do not create a Draft or a new version, and never change
          published versions.
        </div>
      </section>

      <section>
        <div className={styles.blockTitle}>Process compliance — fixture data</div>
        {agg.tradeCount === 0 ? (
          <div className={styles.empty}>No associated trades yet.</div>
        ) : (
          <>
            <div className={styles.complianceLine}>
              <ComplianceReadout summary={agg.pooled} showBasis />
              <span className={styles.staticNote}>{sampleLabel(agg.tradeCount)}</span>
            </div>
            <div className={styles.facts2}>
              <span>
                Review: {agg.fullyReviewed} of {agg.tradeCount} trades fully reviewed
              </span>
              <span className="num">
                {agg.pooled.pass}P {agg.pooled.fail}F {agg.pooled.na}N/A {agg.pooled.unreviewed}U
              </span>
            </div>
            <div className={styles.staticNote}>
              Pooled over rule results. An observation, not evidence that any rule causes any outcome.
            </div>

            <div className={styles.blockTitle}>Outcome context — secondary</div>
            <div className={styles.facts2}>
              <span>Net P&L across these trades</span>
              <span className={`num ${styles.mutedNum}`}>{formatUsd(agg.netPnl)}</span>
            </div>
            <div className={styles.staticNote}>
              Shown for context only. P&L is not an input to compliance and does not indicate process quality.
            </div>
          </>
        )}

        {version && (
          <>
            <div className={styles.blockTitle}>Evaluation example — illustrative, not a real trade</div>
            <div className={styles.exampleList}>
              {example.map(({ rule, state }) => (
                <div key={rule.id} className={styles.exampleRow}>
                  <span className={styles.ruleName}>{rule.name}</span>
                  <RuleStateTag state={state} />
                </div>
              ))}
            </div>
            <div className={styles.exampleFoot}>
              <span>
                Compliance: <ComplianceReadout summary={exampleSummary} showBasis />
              </span>
              <ReviewTag summary={exampleSummary} />
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function DetailsForm({
  strategy,
  otherNames,
  onSave,
  onCancel
}: {
  strategy: Strategy
  otherNames: string[]
  onSave: (name: string, description: string) => void | Promise<void>
  onCancel: () => void
}): JSX.Element {
  const [name, setName] = useState(strategy.name)
  const [description, setDescription] = useState(strategy.description)
  const trimmed = name.trim()
  const duplicate = otherNames.includes(trimmed.toLowerCase())
  const valid = trimmed !== '' && !duplicate

  return (
    <form
      className={styles.detailsForm}
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave(trimmed, description.trim())
      }}
    >
      <input
        className={styles.input}
        value={name}
        aria-label="Strategy name"
        placeholder="Strategy name"
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      />
      {duplicate && <div className={styles.fieldError}>A strategy with this name already exists.</div>}
      <textarea
        className={styles.textarea}
        value={description}
        aria-label="Strategy description"
        placeholder="Description"
        rows={3}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className={styles.formRow}>
        <button type="submit" className={styles.buttonPrimary} disabled={!valid}>
          Save details
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
