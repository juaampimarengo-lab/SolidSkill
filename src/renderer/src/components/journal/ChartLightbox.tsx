import { useEffect, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { MediaItemDto } from '@shared/ipc/media'
import { stageI18nKey, timeframeLabel } from '@renderer/lib/media'
import styles from './ChartLightbox.module.css'

interface ChartLightboxProps {
  item: MediaItemDto
  onClose: () => void
  /** Extra header actions (e.g. delete) rendered before the close button. */
  actions?: ReactNode
}

/** Full-size, real-aspect-ratio preview of one chart image. Closes on X, Escape, or an outside click. */
export function ChartLightbox({ item, onClose, actions }: ChartLightboxProps): JSX.Element {
  const { t } = useTranslation('journal')

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.lightbox} role="dialog" aria-label={t('preview')} onClick={onClose}>
      <div className={styles.lightboxInner} onClick={(event) => event.stopPropagation()}>
        <div className={styles.lightboxHeader}>
          <span className={styles.lightboxMeta}>
            {timeframeLabel(item.timeframe) || t('timeframe.other')} · {t(stageI18nKey(item.stage))}
          </span>
          <div className={styles.lightboxActions}>
            {actions}
            <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('closePreview')}>
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <img className={styles.lightboxImage} src={item.url} alt="" />
        {item.caption !== '' && <p className={styles.lightboxCaption}>{item.caption}</p>}
      </div>
    </div>
  )
}
