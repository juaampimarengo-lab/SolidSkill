import { useState, type CSSProperties, type JSX, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2 } from 'lucide-react'
import type { MediaItemDto } from '@shared/ipc/media'
import { stageI18nKey, timeframeLabel } from '@renderer/lib/media'
import styles from './TradeReviewWorkspace.module.css'

// Most Chart Evidence is a fullscreen TradingView capture, so 16:9 is the
// best guess for the frame until the selected image reports its real size.
const DEFAULT_RATIO = 16 / 9

interface ChartEvidenceViewerProps {
  items: MediaItemDto[]
  selected: MediaItemDto
  onSelect: (mediaId: string) => void
  onOpen: (item: MediaItemDto) => void
}

/**
 * Main Trade Review chart viewer. The frame takes the selected image's own
 * aspect ratio (read from the decoded image — dimensions are not persisted),
 * so the chart fills the column width instead of being letterboxed inside a
 * fixed-height box; the height is capped by the viewport (see CSS) and the
 * width shrinks to match when that cap is hit, so nothing is cropped or
 * stretched at any ratio.
 */
export function ChartEvidenceViewer({ items, selected, onSelect, onOpen }: ChartEvidenceViewerProps): JSX.Element {
  const { t } = useTranslation('journal')
  // Keyed by media id and fed by the thumbnails too, so switching timeframe
  // lands on the right geometry immediately instead of reflowing after load.
  const [ratios, setRatios] = useState<Record<string, number>>({})

  const recordRatio = (id: string) => (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (naturalWidth <= 0 || naturalHeight <= 0) return
    const ratio = naturalWidth / naturalHeight
    setRatios((current) => (current[id] === ratio ? current : { ...current, [id]: ratio }))
  }

  const label = (item: MediaItemDto): string =>
    `${timeframeLabel(item.timeframe) || t('timeframe.other')} · ${t(stageI18nKey(item.stage))}`
  const frameStyle = { '--chart-ratio': ratios[selected.id] ?? DEFAULT_RATIO } as CSSProperties

  return (
    <>
      <div className={styles.chartEvidenceMeta}>
        <div className={`${styles.blockTitle} ${styles.chartEvidenceTitle}`}>{t('chartEvidence')}</div>
        <div className={styles.chartEvidenceMetaRight}>
          <span className={styles.chartEvidenceLabel}>{label(selected)}</span>
          <button
            type="button"
            className={styles.chartEvidenceExpand}
            onClick={() => onOpen(selected)}
            aria-label={t('openPreview')}
            title={t('openPreview')}
          >
            <Maximize2 size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <button
        type="button"
        className={styles.chartEvidenceFrame}
        style={frameStyle}
        onClick={() => onOpen(selected)}
        aria-label={`${t('openPreview')} — ${label(selected)}`}
      >
        <img className={styles.chartEvidenceImage} src={selected.url} alt="" onLoad={recordRatio(selected.id)} />
      </button>
      {items.length > 1 && (
        <div className={styles.chartEvidenceThumbs}>
          {items.map((item) => {
            const active = item.id === selected.id
            return (
              <button
                key={item.id}
                type="button"
                className={active ? `${styles.chartEvidenceThumb} ${styles.chartEvidenceThumbActive}` : styles.chartEvidenceThumb}
                onClick={() => onSelect(item.id)}
                aria-pressed={active}
                aria-label={label(item)}
                title={label(item)}
              >
                <img className={styles.chartEvidenceThumbImg} src={item.url} alt="" onLoad={recordRatio(item.id)} />
                <span className={styles.chartEvidenceThumbLabel}>{timeframeLabel(item.timeframe) || t('timeframe.other')}</span>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
