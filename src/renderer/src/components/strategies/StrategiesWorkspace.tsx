import { useState, type JSX } from 'react'
import { Plus } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { Strategy } from '@renderer/types/strategy'
import type { TradeSummary } from '@renderer/types/journal'
import type { StrategyActions } from '@renderer/hooks/useStrategies'
import { currentVersion, publishBlocker } from '@renderer/lib/strategyDraft'
import { aggregateStrategyTrades, tradesForStrategy } from '@renderer/lib/strategyTrades'
import { CompactCompliance } from '@renderer/components/shared/CompactCompliance'
import { OverviewTab } from './OverviewTab'
import { RulesTab } from './RulesTab'
import { VersionsTab } from './VersionsTab'
import { TradesTab } from './TradesTab'
import styles from './Strategies.module.css'

type Tab = 'Overview' | 'Rules' | 'Versions' | 'Trades'
const tabs: Tab[] = ['Overview', 'Rules', 'Versions', 'Trades']

interface StrategiesWorkspaceProps {
  strategies: Strategy[]
  // The persisted Trade universe; a strategy's trades are those whose exact
  // Strategy Version belongs to that strategy's stable id.
  trades: readonly TradeSummary[]
  actions: StrategyActions
  // Message from the last refused/failed persistence action, if any.
  actionError: string | null
  onDismissError: () => void
  onOpenTradeReview: (tradeId: string) => void
}

export function StrategiesWorkspace({
  strategies,
  trades,
  actions,
  actionError,
  onDismissError,
  onOpenTradeReview
}: StrategiesWorkspaceProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>(strategies[0]?.id ?? '')
  const [tab, setTab] = useState<Tab>('Overview')
  const [creating, setCreating] = useState(false)

  const { t } = useTranslation('strategy')
  const { t: tCommon } = useTranslation('common')
  const selected = strategies.find((s) => s.id === selectedId) ?? strategies[0] ?? null
  const active = strategies.filter((s) => s.status === 'Active')
  const archived = strategies.filter((s) => s.status === 'Archived')

  return (
    <div className={styles.workspace}>
      <aside className={styles.listPane}>
        <div className={styles.listHead}>
          <span className={styles.paneTitle}>Strategies</span>
          <button type="button" className={styles.buttonSecondary} onClick={() => setCreating(true)}>
            <Plus size={12} strokeWidth={1.75} />
            {tCommon('create')}
          </button>
        </div>

        {creating && (
          <CreateForm
            existingNames={strategies.map((s) => s.name.toLowerCase())}
            onCancel={() => setCreating(false)}
            onCreate={async (name, description) => {
              const created = await actions.create(name, description)
              if (!created) return
              setSelectedId(created.id)
              setTab('Rules')
              setCreating(false)
            }}
          />
        )}

        <div className={styles.listScroll}>
          <div className={styles.listSection}>Active · {active.length}</div>
          {active.map((s) => (
            <StrategyRow key={s.id} strategy={s} trades={trades} selected={s.id === selected?.id} onSelect={() => setSelectedId(s.id)} />
          ))}
          {archived.length > 0 && <div className={styles.listSection}>Archived · {archived.length}</div>}
          {archived.map((s) => (
            <StrategyRow key={s.id} strategy={s} trades={trades} selected={s.id === selected?.id} onSelect={() => setSelectedId(s.id)} />
          ))}
        </div>
      </aside>

      <section className={styles.detailPane}>
        {selected ? (
          <StrategyDetail
            key={selected.id}
            strategy={selected}
            trades={trades}
            tab={tab}
            onTab={setTab}
            otherNames={strategies.filter((s) => s.id !== selected.id).map((s) => s.name.toLowerCase())}
            actions={actions}
            actionError={actionError}
            onDismissError={onDismissError}
            onOpenTradeReview={onOpenTradeReview}
          />
        ) : (
          <>
            <ErrorBanner message={actionError} onDismiss={onDismissError} />
            <div className={styles.empty}>{t('empty.noStrategies')}</div>
          </>
        )}
      </section>
    </div>
  )
}

function StrategyRow({
  strategy,
  trades,
  selected,
  onSelect
}: {
  strategy: Strategy
  trades: readonly TradeSummary[]
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const version = currentVersion(strategy)
  const agg = aggregateStrategyTrades(tradesForStrategy(strategy.id, trades))
  return (
    <button
      type="button"
      className={selected ? `${styles.listRow} ${styles.listRowActive}` : styles.listRow}
      onClick={onSelect}
    >
      <span className={styles.listRowTop}>
        <span className={strategy.status === 'Archived' ? styles.listNameMuted : styles.listName}>{strategy.name}</span>
        <span className={`num ${styles.listVersion}`}>{version ? `v${version.number}` : '—'}</span>
      </span>
      <span className={styles.listRowSub}>
        <span>
          {agg.tradeCount} {agg.tradeCount === 1 ? 'trade' : 'trades'}
          {agg.tradeCount > 0 && <> · <CompactCompliance summary={agg.pooled} /></>}
        </span>
        {strategy.draft && <span className={styles.draftTag}>{version ? 'Draft' : 'Draft · unpublished'}</span>}
      </span>
    </button>
  )
}

function CreateForm({
  existingNames,
  onCreate,
  onCancel
}: {
  existingNames: string[]
  onCreate: (name: string, description: string) => void | Promise<void>
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation('strategy')
  const { t: tCommon } = useTranslation('common')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const trimmed = name.trim()
  const duplicate = existingNames.includes(trimmed.toLowerCase())
  const valid = trimmed !== '' && !duplicate

  return (
    <form
      className={styles.createForm}
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onCreate(trimmed, description.trim())
      }}
    >
      <input
        className={styles.input}
        placeholder={t('create.namePlaceholder')}
        aria-label={t('create.namePlaceholder')}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {duplicate && <div className={styles.fieldError}>{t('nameDuplicate')}</div>}
      <textarea
        className={styles.textarea}
        placeholder={t('create.descriptionPlaceholder')}
        aria-label={t('create.descriptionPlaceholder')}
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className={styles.formRow}>
        <button type="submit" className={styles.buttonPrimary} disabled={!valid}>
          {t('create.submit')}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
          {tCommon('cancel')}
        </button>
      </div>
      <div className={styles.staticNote}>{t('create.versionNote')}</div>
    </form>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }): JSX.Element | null {
  const { t } = useTranslation('common')
  if (!message) return null
  return (
    <div className={styles.actionError} role="alert">
      <span>{message}</span>
      <button type="button" className={styles.buttonSecondary} onClick={onDismiss}>
        {t('dismiss')}
      </button>
    </div>
  )
}

type Confirm = 'publish' | 'delete' | null

function StrategyDetail({
  strategy,
  trades,
  tab,
  onTab,
  actions,
  actionError,
  onDismissError,
  otherNames,
  onOpenTradeReview
}: {
  strategy: Strategy
  trades: readonly TradeSummary[]
  tab: Tab
  onTab: (tab: Tab) => void
  actions: StrategyActions
  actionError: string | null
  onDismissError: () => void
  otherNames: string[]
  onOpenTradeReview: (tradeId: string) => void
}): JSX.Element {
  const { t } = useTranslation('strategy')
  const { t: tCommon } = useTranslation('common')
  const [confirm, setConfirm] = useState<Confirm>(null)
  const version = currentVersion(strategy)
  const draft = strategy.draft
  const blocker = publishBlocker(strategy)
  const nextNumber = (version?.number ?? 0) + 1
  const canArchive = strategy.status === 'Active' && strategy.versions.length > 0 && !draft
  const numSpan = [<span key="num" className="num" />]

  return (
    <div className={styles.detail}>
      <ErrorBanner message={actionError} onDismiss={onDismissError} />
      <header className={styles.detailHead}>
        <div className={styles.detailTitleRow}>
          <h2 className={styles.detailTitle}>{strategy.name}</h2>
          <span className={`num ${styles.versionBadge}`}>{version ? `Published v${version.number}` : 'Unpublished'}</span>
          {draft && (
            <span className={styles.draftBadge}>
              {draft.basedOn !== null ? `Draft based on v${draft.basedOn}` : 'Draft'}
            </span>
          )}
          {strategy.status === 'Archived' && <span className={styles.archivedBadge}>Archived</span>}
        </div>
        <div className={styles.headActions}>
          {canArchive && (
            <button type="button" className={styles.buttonSecondary} onClick={() => void actions.setArchived(strategy.id, true)}>
              {tCommon('archive')}
            </button>
          )}
        </div>
      </header>

      {/* Lifecycle strip — makes the published/draft distinction explicit on every tab. */}
      <div className={draft ? `${styles.strip} ${styles.stripDraft}` : styles.strip}>
        {strategy.status === 'Archived' ? (
          <>
            <span>{t('archivedBanner')}</span>
            <button type="button" className={styles.buttonSecondary} onClick={() => void actions.setArchived(strategy.id, false)}>
              {tCommon('restore')}
            </button>
          </>
        ) : draft ? (
          confirm === 'publish' ? (
            <>
              <span>
                {version ? (
                  <Trans
                    i18nKey="publishConfirm.questionWithPrevious"
                    t={t}
                    values={{ version: nextNumber, previous: version.number }}
                    components={numSpan}
                  />
                ) : (
                  <Trans i18nKey="publishConfirm.question" t={t} values={{ version: nextNumber }} components={numSpan} />
                )}
              </span>
              <span className={styles.stripActions}>
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  onClick={async () => {
                    await actions.publishDraft(strategy.id)
                    setConfirm(null)
                  }}
                >
                  {t('actions.confirmPublish')}
                </button>
                <button type="button" className={styles.buttonSecondary} onClick={() => setConfirm(null)}>
                  {tCommon('cancel')}
                </button>
              </span>
            </>
          ) : confirm === 'delete' ? (
            <>
              <span>{t('deleteConfirm')}</span>
              <span className={styles.stripActions}>
                <button type="button" className={styles.buttonPrimary} onClick={() => void actions.removeUnpublished(strategy.id)}>
                  {t('actions.confirmDelete')}
                </button>
                <button type="button" className={styles.buttonSecondary} onClick={() => setConfirm(null)}>
                  {tCommon('cancel')}
                </button>
              </span>
            </>
          ) : (
            <>
              <span>
                {draft.basedOn !== null ? (
                  <Trans i18nKey="draft.basedOn" t={t} values={{ version: draft.basedOn }} components={numSpan} />
                ) : (
                  t('draft.unpublishedNote')
                )}
                {blocker && <span className={styles.blocker}> {blocker}.</span>}
              </span>
              <span className={styles.stripActions}>
                {version ? (
                  <button type="button" className={styles.buttonSecondary} onClick={() => void actions.discardDraft(strategy.id)}>
                    {t('actions.discardChanges')}
                  </button>
                ) : (
                  <button type="button" className={styles.buttonSecondary} onClick={() => setConfirm('delete')}>
                    {t('actions.deleteStrategy')}
                  </button>
                )}
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  disabled={blocker !== null}
                  onClick={() => setConfirm('publish')}
                >
                  <Trans i18nKey="actions.publishChangesAs" t={t} values={{ version: nextNumber }} components={numSpan} />
                </button>
              </span>
            </>
          )
        ) : (
          <span>
            <Trans i18nKey="publishedBanner" t={t} values={{ version: version?.number }} components={numSpan} />
          </span>
        )}
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Strategy sections">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => onTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className={styles.tabBody}>
        {tab === 'Overview' && (
          <OverviewTab
            strategy={strategy}
            trades={trades}
            onSaveDetails={(name, description) => actions.updateDetails(strategy.id, name, description)}
            otherNames={otherNames}
          />
        )}
        {tab === 'Rules' && <RulesTab strategy={strategy} actions={actions} />}
        {tab === 'Versions' && <VersionsTab strategy={strategy} trades={trades} />}
        {tab === 'Trades' && <TradesTab strategy={strategy} trades={trades} onOpenTradeReview={onOpenTradeReview} />}
      </div>
    </div>
  )
}
