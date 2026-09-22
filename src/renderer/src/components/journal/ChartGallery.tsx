import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Star, Trash2 } from 'lucide-react'
import type { MediaItemDto } from '@shared/ipc/media'
import { stageI18nKey, timeframeLabel } from '@renderer/lib/media'
import { DataStatus } from '@renderer/components/shared/DataStatus'
import type { Loadable } from '@renderer/hooks/useMedia'
import { ChartLightbox } from './ChartLightbox'
import styles from './ChartGallery.module.css'

interface ChartGalleryProps {
  state: Loadable<MediaItemDto[]>
  retry: () => void
  onAdd: () => void
  onDelete: (mediaId: string) => Promise<void> | void
  /** Present only for Trade media — Day media has no Overview concept, so no star control is shown when absent. */
  onSetFeatured?: (mediaId: string) => Promise<void> | void
  compact?: boolean
}

export function ChartGallery({ state, retry, onAdd, onDelete, onSetFeatured, compact }: ChartGalleryProps): JSX.Element {
  const { t } = useTranslation('journal')
  const [preview, setPreview] = useState<MediaItemDto | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [settingFeatured, setSettingFeatured] = useState<string | null>(null)

  const handleDelete = async (item: MediaItemDto): Promise<void> => {
    if (!window.confirm(t('deleteConfirm'))) return
    setDeleting(item.id)
    try {
      await onDelete(item.id)
      setPreview((current) => (current?.id === item.id ? null : current))
    } finally {
      setDeleting(null)
    }
  }

  const handleSetFeatured = async (item: MediaItemDto): Promise<void> => {
    if (!onSetFeatured || item.isFeatured) return
    setSettingFeatured(item.id)
    try {
      await onSetFeatured(item.id)
    } finally {
      setSettingFeatured(null)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.title}>{t('chartEvidence')}</span>
        <button type="button" className={styles.addButton} onClick={onAdd}>
          <Plus size={13} strokeWidth={1.75} />
          {t('addChart')}
        </button>
      </div>

      {state.status !== 'ready' ? (
        <DataStatus what={t('chartEvidence')} state={state} onRetry={retry} />
      ) : state.data.length === 0 ? (
        <p className={styles.empty}>{t('noChartsAttached')}</p>
      ) : (
        <div className={compact ? `${styles.grid} ${styles.gridCompact}` : styles.grid}>
          {state.data.map((item) => (
            <button key={item.id} type="button" className={styles.tile} onClick={() => setPreview(item)}>
              <div className={styles.thumbWrap}>
                {/* Eager, not lazy: native lazy-loading is paused while the
                    window is occluded/unfocused, which would leave a
                    freshly-added chart's first paint stuck unloaded (seen in
                    Day Review, Checkpoint 014) — this gallery is always a
                    handful of images, never a long list worth deferring. */}
                <img className={styles.thumb} src={item.url} alt="" />
                {onSetFeatured && (
                  <button
                    type="button"
                    className={item.isFeatured ? `${styles.starButton} ${styles.starButtonActive}` : styles.starButton}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleSetFeatured(item)
                    }}
                    disabled={settingFeatured === item.id}
                    aria-label={item.isFeatured ? t('featuredChart') : t('showInOverview')}
                    title={item.isFeatured ? t('featuredChart') : t('showInOverview')}
                  >
                    <Star size={12} strokeWidth={1.75} fill={item.isFeatured ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
              <div className={styles.tileMeta}>
                <span className={styles.tileTimeframe}>
                  {timeframeLabel(item.timeframe) || t('timeframe.other')}
                </span>
                <span className={styles.tileStage}>{t(stageI18nKey(item.stage))}</span>
              </div>
              {item.caption !== '' && <div className={styles.tileCaption}>{item.caption}</div>}
            </button>
          ))}
        </div>
      )}

      {preview && (
        <ChartLightbox
          item={preview}
          onClose={() => setPreview(null)}
          actions={
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void handleDelete(preview)}
              disabled={deleting === preview.id}
              aria-label={t('delete')}
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          }
        />
      )}
    </div>
  )
}
