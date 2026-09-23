import { useEffect, useMemo, useState, type JSX } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { StrategyDto, StrategyVersionDto } from '@shared/ipc/strategies'
import type { TradeDetailDto } from '@shared/ipc/trades'
import styles from './AssignStrategyModal.module.css'

// One-time V1 assignment of an EXACT published Strategy Version to a Trade
// that has none (docs/STRATEGY_ASSIGNMENT.md). The user picks a Strategy and
// then one specific published Version; the current Version is only the
// default selection, never an implicit choice made after confirmation. The
// confirmation line always names the exact Strategy · Version that will be
// written. Strategy and Rule names are user data and are shown as stored.

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; strategies: StrategyDto[] }

function latest(strategy: StrategyDto): StrategyVersionDto | null {
  return strategy.versions[strategy.versions.length - 1] ?? null
}

function ruleCount(version: StrategyVersionDto): number {
  return version.groups.reduce((n, g) => n + g.rules.length, 0)
}

export function AssignStrategyModal({
  tradeId,
  onClose,
  onAssigned
}: {
  tradeId: string
  onClose: () => void
  onAssigned: (detail: TradeDetailDto) => void
}): JSX.Element {
  const { t, i18n } = useTranslation('journal')
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [showArchived, setShowArchived] = useState(false)
  const [strategyId, setStrategyId] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const api = window.solidSkill?.strategies
    if (!api) {
      setLoad({ status: 'error' })
      return
    }
    api
      .list()
      .then((result) => {
        if (alive) setLoad(result.ok ? { status: 'ready', strategies: result.data } : { status: 'error' })
      })
      .catch(() => {
        if (alive) setLoad({ status: 'error' })
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  // Only strategies with at least one published version can be assigned (a
  // Draft is never evaluated). Active first; archived only on request.
  const assignable = useMemo(() => {
    if (load.status !== 'ready') return { active: [], archived: [] }
    const published = load.strategies.filter((s) => s.versions.length > 0).sort((a, b) => a.position - b.position)
    return {
      active: published.filter((s) => s.status === 'Active'),
      archived: published.filter((s) => s.status === 'Archived')
    }
  }, [load])

  const visible = showArchived ? [...assignable.active, ...assignable.archived] : assignable.active
  const strategy = visible.find((s) => s.id === strategyId) ?? null
  const current = strategy ? latest(strategy) : null
  const version = strategy?.versions.find((v) => v.id === versionId) ?? null

  function chooseStrategy(next: StrategyDto): void {
    setStrategyId(next.id)
    // Default to the current published version; any historical one stays selectable.
    setVersionId(latest(next)?.id ?? null)
    setError(null)
  }

  async function assign(): Promise<void> {
    const api = window.solidSkill?.trades
    if (!api || version === null) return
    setSaving(true)
    setError(null)
    try {
      // The exact version id the user sees selected is what is sent — never a strategy id.
      const result = await api.assignStrategyVersion({ tradeId, strategyVersionId: version.id })
      if (result.ok) {
        onAssigned(result.data)
        return
      }
      setError(result.error.message)
    } catch {
      setError(t('assign.failed'))
    }
    setSaving(false)
  }

  const date = (epochMs: number): string =>
    new Date(epochMs).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className={styles.backdrop} onClick={() => !saving && onClose()}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('assign.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>{t('assign.title')}</span>
          <button type="button" className={styles.iconButton} onClick={onClose} disabled={saving} aria-label={t('assign.close')}>
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.body}>
          {load.status === 'loading' && <p className={styles.muted}>{t('assign.loading')}</p>}
          {load.status === 'error' && <p className={styles.errorText}>{t('assign.loadFailed')}</p>}
          {load.status === 'ready' && assignable.active.length + assignable.archived.length === 0 && (
            <p className={styles.muted}>{t('assign.noPublished')}</p>
          )}

          {load.status === 'ready' && assignable.active.length + assignable.archived.length > 0 && (
            <>
              <div className={styles.fieldLabel}>{t('assign.strategyLabel')}</div>
              <div className={styles.options} role="radiogroup" aria-label={t('assign.strategyLabel')}>
                {visible.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={s.id === strategyId}
                    className={s.id === strategyId ? `${styles.option} ${styles.optionSelected}` : styles.option}
                    onClick={() => chooseStrategy(s)}
                  >
                    <span className={s.status === 'Archived' ? styles.optionNameMuted : styles.optionName}>{s.name}</span>
                    <span className={styles.optionMeta}>
                      {s.status === 'Archived' && <span className={styles.archivedTag}>{t('assign.archived')}</span>}
                      <span className="num">v{latest(s)?.number}</span>
                    </span>
                  </button>
                ))}
              </div>
              {assignable.archived.length > 0 && (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    if (showArchived && strategy?.status === 'Archived') {
                      setStrategyId(null)
                      setVersionId(null)
                    }
                    setShowArchived((v) => !v)
                  }}
                >
                  {showArchived ? t('assign.hideArchived') : t('assign.showArchived')}
                </button>
              )}

              {strategy && (
                <>
                  <div className={styles.fieldLabel}>{t('assign.versionLabel')}</div>
                  <div className={styles.options} role="radiogroup" aria-label={t('assign.versionLabel')}>
                    {[...strategy.versions].reverse().map((v) => {
                      const isCurrent = v.id === current?.id
                      return (
                        <button
                          key={v.id}
                          type="button"
                          role="radio"
                          aria-checked={v.id === versionId}
                          data-version-id={v.id}
                          className={v.id === versionId ? `${styles.option} ${styles.optionSelected}` : styles.option}
                          onClick={() => setVersionId(v.id)}
                        >
                          <span className={styles.optionName}>
                            <span className="num">v{v.number}</span>
                            <span className={isCurrent ? styles.currentTag : styles.historicalTag}>
                              {isCurrent ? t('assign.current') : t('assign.historical')}
                            </span>
                          </span>
                          <span className={styles.optionMeta}>
                            {t('assign.versionMeta', { count: ruleCount(v), date: date(v.publishedAt) })}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {version && current && version.id !== current.id && (
                    <p className={styles.muted}>{t('assign.historicalNote', { current: current.number })}</p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {strategy && version && (
          <div className={styles.confirm}>
            <p className={styles.confirmLine}>
              <Trans
                i18nKey="assign.confirm"
                t={t}
                values={{ strategy: strategy.name, version: version.number }}
                components={[<strong key="exact" className={styles.exact} />]}
              />
            </p>
            <p className={styles.muted}>
              {t('assign.confirmDetail', { count: ruleCount(version), version: version.number })}
            </p>
            {error && <p className={styles.errorText}>{error}</p>}
          </div>
        )}

        <div className={styles.footer}>
          <button type="button" className={styles.buttonSecondary} onClick={onClose} disabled={saving}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={version === null || saving}
            onClick={() => void assign()}
          >
            {saving ? t('assign.assigning') : t('assign.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
