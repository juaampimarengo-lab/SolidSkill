import { useEffect, useRef, useState, type JSX } from 'react'
import { GripVertical, MoreHorizontal, Plus } from 'lucide-react'
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
  // Each section in its manual display order (presentation metadata only).
  const byPosition = (a: Strategy, b: Strategy): number => a.position - b.position
  const active = strategies.filter((s) => s.status === 'Active').sort(byPosition)
  const archived = strategies.filter((s) => s.status === 'Archived').sort(byPosition)

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
          <div className={styles.listSection}>{t('list.activeSection', { count: active.length })}</div>
          <StrategySection
            items={active}
            trades={trades}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onMove={(id, toIndex) => void actions.move(id, toIndex)}
          />
          {archived.length > 0 && (
            <div className={styles.listSection}>{t('list.archivedSection', { count: archived.length })}</div>
          )}
          <StrategySection
            items={archived}
            trades={trades}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onMove={(id, toIndex) => void actions.move(id, toIndex)}
          />
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

// One lifecycle section (Active or Archived) of the list. Reordering happens
// only inside a section: dragging never archives or restores, and the order is
// list presentation metadata — it never creates a Draft or a Version.
function StrategySection({
  items,
  trades,
  selectedId,
  onSelect,
  onMove
}: {
  items: Strategy[]
  trades: readonly TradeSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onMove: (id: string, toIndex: number) => void
}): JSX.Element {
  // Drag state is per section, so a row from the other section is never a
  // valid drop. Refs decide (synchronously, independent of render timing);
  // state only drives the visuals.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null)
  const dragRef = useRef<string | null>(null)
  const dropRef = useRef<{ id: string; after: boolean } | null>(null)

  function reset(): void {
    dragRef.current = null
    dropRef.current = null
    setDragId(null)
    setDropAt(null)
  }

  function drop(): void {
    const dragged = dragRef.current
    const target = dropRef.current
    if (dragged !== null && target !== null) {
      const from = items.findIndex((s) => s.id === dragged)
      const over = items.findIndex((s) => s.id === target.id)
      if (from >= 0 && over >= 0) {
        let to = over + (target.after ? 1 : 0)
        if (from < to) to -= 1
        if (to !== from) onMove(dragged, to)
      }
    }
    reset()
  }

  return (
    <>
      {items.map((s, index) => (
        <StrategyRow
          key={s.id}
          strategy={s}
          trades={trades}
          selected={s.id === selectedId}
          onSelect={() => onSelect(s.id)}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
          onMoveUp={() => onMove(s.id, index - 1)}
          onMoveDown={() => onMove(s.id, index + 1)}
          dragging={dragId === s.id}
          dropIndicator={dropAt?.id === s.id && dragId !== s.id ? (dropAt.after ? 'after' : 'before') : null}
          onDragStart={() => {
            dragRef.current = s.id
            setDragId(s.id)
          }}
          onDragOver={(after) => {
            if (dragRef.current === null) return false
            dropRef.current = { id: s.id, after }
            setDropAt((current) => (current?.id === s.id && current.after === after ? current : { id: s.id, after }))
            return true
          }}
          onDrop={drop}
          onDragEnd={reset}
        />
      ))}
    </>
  )
}

function StrategyRow({
  strategy,
  trades,
  selected,
  onSelect,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  dragging,
  dropIndicator,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  strategy: Strategy
  trades: readonly TradeSummary[]
  selected: boolean
  onSelect: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  dragging: boolean
  dropIndicator: 'before' | 'after' | null
  onDragStart: () => void
  /** Returns whether this row accepts the current drag (same section only). */
  onDragOver: (after: boolean) => boolean
  onDrop: () => void
  onDragEnd: () => void
}): JSX.Element {
  const { t } = useTranslation('strategy')
  const version = currentVersion(strategy)
  const agg = aggregateStrategyTrades(tradesForStrategy(strategy.id, trades))
  const wrapClass = [
    styles.listRowWrap,
    dragging ? styles.listRowDragging : '',
    dropIndicator === 'before' ? styles.dropBefore : '',
    dropIndicator === 'after' ? styles.dropAfter : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={wrapClass}
      draggable
      data-strategy-id={strategy.id}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', strategy.id)
        onDragStart()
      }}
      onDragOver={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        if (onDragOver(e.clientY > rect.top + rect.height / 2)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
    >
      <span className={styles.dragHandle} aria-hidden="true" title={t('list.dragToReorder')}>
        <GripVertical size={12} strokeWidth={1.75} />
      </span>
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
      <RowMenu
        name={strategy.name}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      />
    </div>
  )
}

// Restrained, keyboard-reachable alternative to drag/drop.
function RowMenu({
  name,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown
}: {
  name: string
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}): JSX.Element {
  const { t } = useTranslation('strategy')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (fn: () => void) => (): void => {
    setOpen(false)
    fn()
  }

  return (
    <div ref={ref} className={open ? `${styles.rowMenu} ${styles.rowMenuOpen}` : styles.rowMenu}>
      <button
        type="button"
        className={styles.rowMenuButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('list.rowActions', { name })}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={13} strokeWidth={1.75} />
      </button>
      {open && (
        <div className={styles.rowMenuList} role="menu">
          <button type="button" role="menuitem" className={styles.rowMenuItem} disabled={!canMoveUp} onClick={pick(onMoveUp)}>
            {t('list.moveUp')}
          </button>
          <button type="button" role="menuitem" className={styles.rowMenuItem} disabled={!canMoveDown} onClick={pick(onMoveDown)}>
            {t('list.moveDown')}
          </button>
        </div>
      )}
    </div>
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
