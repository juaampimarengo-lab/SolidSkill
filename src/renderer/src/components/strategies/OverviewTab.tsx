import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('strategy')
  const { t: tCommon } = useTranslation('common')
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
          {t('overview.definition')}
          {!editingDetails && strategy.status === 'Active' && (
            <button type="button" className={styles.buttonSecondary} onClick={() => setEditingDetails(true)}>
              {t('actions.editDetails')}
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
              <dt>{tCommon('name')}</dt>
              <dd>{strategy.name}</dd>
              <dt>{tCommon('description')}</dt>
              <dd>{strategy.description || '—'}</dd>
            </>
          )}
          <dt>{tCommon('status')}</dt>
          <dd>{strategy.status}</dd>
          <dt>{t('overview.publishedVersion')}</dt>
          <dd className="num">{version ? `v${version.number}` : t('overview.noneYet')}</dd>
          <dt>{t('overview.ruleGroups')}</dt>
          <dd className="num">
            {shownGroups.length}
            {!version && ' (draft)'}
          </dd>
          <dt>{t('overview.rules')}</dt>
          <dd className="num">
            {ruleCount(shownGroups)}
            {!version && ' (draft)'}
          </dd>
          <dt>{t('overview.tradesAssociated')}</dt>
          <dd className="num">{agg.tradeCount}</dd>
        </dl>
        <div className={styles.staticNote}>{t('overview.detailsNote')}</div>
      </section>

      <section>
        <div className={styles.blockTitle}>{t('overview.complianceTitle')}</div>
        {agg.tradeCount === 0 ? (
          <div className={styles.empty}>{t('empty.noAssociatedTrades')}</div>
        ) : (
          <>
            <div className={styles.complianceLine}>
              <ComplianceReadout summary={agg.pooled} showBasis />
              <span className={styles.staticNote}>{sampleLabel(agg.tradeCount)}</span>
            </div>
            <div className={styles.facts2}>
              <span>{t('overview.reviewLine', { reviewed: agg.fullyReviewed, total: agg.tradeCount })}</span>
              <span className="num">
                {agg.pooled.pass}P {agg.pooled.fail}F {agg.pooled.na}N/A {agg.pooled.unreviewed}U
              </span>
            </div>
            <div className={styles.staticNote}>{t('overview.pooledNote')}</div>

            <div className={styles.blockTitle}>{t('overview.outcomeTitle')}</div>
            <div className={styles.facts2}>
              <span>{t('overview.netPnlLabel')}</span>
              <span className={`num ${styles.mutedNum}`}>{formatUsd(agg.netPnl)}</span>
            </div>
            <div className={styles.staticNote}>{t('overview.pnlDisclaimer')}</div>
          </>
        )}

        {version && (
          <>
            <div className={styles.blockTitle}>{t('overview.exampleTitle')}</div>
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
                {t('overview.complianceLabel')} <ComplianceReadout summary={exampleSummary} showBasis />
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
  const { t } = useTranslation('strategy')
  const { t: tCommon } = useTranslation('common')
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
        aria-label={t('create.namePlaceholder')}
        placeholder={t('create.namePlaceholder')}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      />
      {duplicate && <div className={styles.fieldError}>{t('nameDuplicate')}</div>}
      <textarea
        className={styles.textarea}
        value={description}
        aria-label={t('create.descriptionPlaceholder')}
        placeholder={t('create.descriptionPlaceholder')}
        rows={3}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className={styles.formRow}>
        <button type="submit" className={styles.buttonPrimary} disabled={!valid}>
          {t('actions.saveDetails')}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  )
}
