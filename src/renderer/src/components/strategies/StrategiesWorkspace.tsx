import { useState, type JSX } from 'react'
import { Plus } from 'lucide-react'
import type { Strategy } from '@renderer/types/strategy'
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
  actions: StrategyActions
  // Message from the last refused/failed persistence action, if any.
  actionError: string | null
  onDismissError: () => void
  onOpenTradeReview: (tradeId: string) => void
}

export function StrategiesWorkspace({
  strategies,
  actions,
  actionError,
  onDismissError,
  onOpenTradeReview
}: StrategiesWorkspaceProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>(strategies[0]?.id ?? '')
  const [tab, setTab] = useState<Tab>('Overview')
  const [creating, setCreating] = useState(false)

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
            Create
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
            <StrategyRow key={s.id} strategy={s} selected={s.id === selected?.id} onSelect={() => setSelectedId(s.id)} />
          ))}
          {archived.length > 0 && <div className={styles.listSection}>Archived · {archived.length}</div>}
          {archived.map((s) => (
            <StrategyRow key={s.id} strategy={s} selected={s.id === selected?.id} onSelect={() => setSelectedId(s.id)} />
          ))}
        </div>
      </aside>

      <section className={styles.detailPane}>
        {selected ? (
          <StrategyDetail
            key={selected.id}
            strategy={selected}
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
            <div className={styles.empty}>No strategies. Create one to begin.</div>
          </>
        )}
      </section>
    </div>
  )
}

function StrategyRow({
  strategy,
  selected,
  onSelect
}: {
  strategy: Strategy
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const version = currentVersion(strategy)
  const agg = aggregateStrategyTrades(tradesForStrategy(strategy))
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
        placeholder="Strategy name"
        aria-label="Strategy name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {duplicate && <div className={styles.fieldError}>A strategy with this name already exists.</div>}
      <textarea
        className={styles.textarea}
        placeholder="Description"
        aria-label="Strategy description"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className={styles.formRow}>
        <button type="submit" className={styles.buttonPrimary} disabled={!valid}>
          Create draft
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className={styles.staticNote}>No version exists until the first Publish (→ v1).</div>
    </form>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }): JSX.Element | null {
  if (!message) return null
  return (
    <div className={styles.actionError} role="alert">
      <span>{message}</span>
      <button type="button" className={styles.buttonSecondary} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

type Confirm = 'publish' | 'delete' | null

function StrategyDetail({
  strategy,
  tab,
  onTab,
  actions,
  actionError,
  onDismissError,
  otherNames,
  onOpenTradeReview
}: {
  strategy: Strategy
  tab: Tab
  onTab: (tab: Tab) => void
  actions: StrategyActions
  actionError: string | null
  onDismissError: () => void
  otherNames: string[]
  onOpenTradeReview: (tradeId: string) => void
}): JSX.Element {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const version = currentVersion(strategy)
  const draft = strategy.draft
  const blocker = publishBlocker(strategy)
  const nextNumber = (version?.number ?? 0) + 1
  const canArchive = strategy.status === 'Active' && strategy.versions.length > 0 && !draft

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
              Archive
            </button>
          )}
        </div>
      </header>

      {/* Lifecycle strip — makes the published/draft distinction explicit on every tab. */}
      <div className={draft ? `${styles.strip} ${styles.stripDraft}` : styles.strip}>
        {strategy.status === 'Archived' ? (
          <>
            <span>Archived — read-only. Versions, history and trade association are retained.</span>
            <button type="button" className={styles.buttonSecondary} onClick={() => void actions.setArchived(strategy.id, false)}>
              Restore
            </button>
          </>
        ) : draft ? (
          confirm === 'publish' ? (
            <>
              <span>
                Publish these changes as <span className="num">v{nextNumber}</span>? It becomes the current version and is
                frozen
                {version && (
                  <>
                    ; <span className="num">v{version.number}</span> stays in Version History unchanged
                  </>
                )}
                .
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
                  Confirm publish
                </button>
                <button type="button" className={styles.buttonSecondary} onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </span>
            </>
          ) : confirm === 'delete' ? (
            <>
              <span>Delete this unpublished strategy? It has no versions or trades.</span>
              <span className={styles.stripActions}>
                <button type="button" className={styles.buttonPrimary} onClick={() => void actions.removeUnpublished(strategy.id)}>
                  Confirm delete
                </button>
                <button type="button" className={styles.buttonSecondary} onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </span>
            </>
          ) : (
            <>
              <span>
                {draft.basedOn !== null ? (
                  <>
                    Editing unpublished changes based on <span className="num">v{draft.basedOn}</span>. Published{' '}
                    <span className="num">v{draft.basedOn}</span> remains unchanged.
                  </>
                ) : (
                  <>Draft — not yet published. No version exists until the first Publish (→ v1).</>
                )}
                {blocker && <span className={styles.blocker}> {blocker}.</span>}
              </span>
              <span className={styles.stripActions}>
                {version ? (
                  <button type="button" className={styles.buttonSecondary} onClick={() => void actions.discardDraft(strategy.id)}>
                    Discard changes
                  </button>
                ) : (
                  <button type="button" className={styles.buttonSecondary} onClick={() => setConfirm('delete')}>
                    Delete Strategy
                  </button>
                )}
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  disabled={blocker !== null}
                  onClick={() => setConfirm('publish')}
                >
                  Publish changes as <span className="num">v{nextNumber}</span>
                </button>
              </span>
            </>
          )
        ) : (
          <>
            <span>
              Published <span className="num">v{version?.number}</span> — frozen, read-only. Rule changes are made in a
              Draft (Rules → Edit Rules).
            </span>
          </>
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
            onSaveDetails={(name, description) => actions.updateDetails(strategy.id, name, description)}
            otherNames={otherNames}
          />
        )}
        {tab === 'Rules' && <RulesTab strategy={strategy} actions={actions} />}
        {tab === 'Versions' && <VersionsTab strategy={strategy} />}
        {tab === 'Trades' && <TradesTab strategy={strategy} onOpenTradeReview={onOpenTradeReview} />}
      </div>
    </div>
  )
}
