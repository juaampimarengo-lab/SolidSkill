import { useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Monitor, Upload, X } from 'lucide-react'
import type { CaptureSourceDto, MediaItemDto, MediaStageDto, MediaTimeframeDto, StagedImageDto } from '@shared/ipc/media'
import { MEDIA_STAGES, MEDIA_TIMEFRAMES } from '@shared/ipc/media'
import { stageI18nKey, timeframeLabel } from '@renderer/lib/media'
import styles from './AddChartModal.module.css'

type Owner = { kind: 'trade'; tradeId: string } | { kind: 'day'; accountId: string; date: string }
type Step = 'source' | 'sources' | 'live' | 'details'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface AddChartModalProps {
  owner: Owner
  onClose: () => void
  onAdded: (item: MediaItemDto) => void
}

export function AddChartModal({ owner, onClose, onAdded }: AddChartModalProps): JSX.Element {
  const { t } = useTranslation('journal')
  const [step, setStep] = useState<Step>('source')
  const [error, setError] = useState<string | null>(null)
  const [staged, setStaged] = useState<StagedImageDto | null>(null)
  const [timeframe, setTimeframe] = useState<MediaTimeframeDto>('M5')
  const [stage, setStage] = useState<MediaStageDto>('ENTRY')
  const [caption, setCaption] = useState('')
  const [saving, setSaving] = useState(false)

  const [sources, setSources] = useState<CaptureSourceDto[] | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement>(null)
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const previewImgRef = useRef<HTMLImageElement>(null)

  async function handlePickFile(): Promise<void> {
    setError(null)
    const api = window.solidSkill?.media
    if (!api) return
    const result = await api.pickImageFile()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (result.data === null) return // user cancelled the dialog
    setStaged(result.data)
    setStep('details')
  }

  async function handleOpenCapture(): Promise<void> {
    setError(null)
    setStep('sources')
    setSources(null)
    const api = window.solidSkill?.media
    if (!api) return
    const result = await api.listCaptureSources()
    if (!result.ok) {
      setError(result.error.message)
      setSources([])
      return
    }
    setSources(result.data)
  }

  async function handlePickSource(source: CaptureSourceDto): Promise<void> {
    setError(null)
    try {
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id
          }
        }
        // Electron's documented desktopCapturer pattern: chromeMediaSourceId is
        // only understood inside this legacy `mandatory` constraint bag.
      } as unknown as MediaStreamConstraints
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const video = document.createElement('video')
      video.srcObject = stream
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('Capture stream failed to load.'))
        void video.play().catch(reject)
      })
      const canvas = captureCanvasRef.current
      if (canvas === null) throw new Error('Capture surface not ready.')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx === null) throw new Error('Could not draw the captured frame.')
      ctx.drawImage(video, 0, 0)
      stream.getTracks().forEach((track) => track.stop())
      setFrameDataUrl(canvas.toDataURL('image/png'))
      setSelection(null)
      setStep('live')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen capture failed.')
    }
  }

  function startSelection(event: ReactMouseEvent<HTMLDivElement>): void {
    const box = event.currentTarget.getBoundingClientRect()
    dragStart.current = { x: event.clientX - box.left, y: event.clientY - box.top }
    setSelection({ x: dragStart.current.x, y: dragStart.current.y, w: 0, h: 0 })
  }

  function updateSelection(event: ReactMouseEvent<HTMLDivElement>): void {
    if (dragStart.current === null) return
    const box = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const start = dragStart.current
    setSelection({
      x: Math.max(0, Math.min(start.x, x)),
      y: Math.max(0, Math.min(start.y, y)),
      w: Math.abs(x - start.x),
      h: Math.abs(y - start.y)
    })
  }

  function endSelection(): void {
    dragStart.current = null
  }

  async function finalizeFrame(useSelection: boolean): Promise<void> {
    const canvas = captureCanvasRef.current
    const api = window.solidSkill?.media
    if (canvas === null || !api) return
    let bytes: ArrayBuffer
    if (useSelection && selection !== null && selection.w > 4 && selection.h > 4 && previewImgRef.current) {
      const displayed = previewImgRef.current
      const scaleX = canvas.width / displayed.clientWidth
      const scaleY = canvas.height / displayed.clientHeight
      const cropped = document.createElement('canvas')
      cropped.width = Math.round(selection.w * scaleX)
      cropped.height = Math.round(selection.h * scaleY)
      const ctx = cropped.getContext('2d')
      if (ctx === null) return
      ctx.drawImage(
        canvas,
        selection.x * scaleX,
        selection.y * scaleY,
        selection.w * scaleX,
        selection.h * scaleY,
        0,
        0,
        cropped.width,
        cropped.height
      )
      bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        cropped.toBlob((blob) => {
          if (blob === null) return reject(new Error('Crop failed.'))
          blob.arrayBuffer().then(resolve, reject)
        }, 'image/png')
      })
    } else {
      bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) return reject(new Error('Capture failed.'))
          blob.arrayBuffer().then(resolve, reject)
        }, 'image/png')
      })
    }
    const result = await api.stageCapturedImage(bytes)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setStaged(result.data)
    setStep('details')
  }

  async function handleSave(): Promise<void> {
    if (staged === null) return
    setSaving(true)
    setError(null)
    const api = window.solidSkill?.media
    if (!api) {
      setSaving(false)
      return
    }
    const result =
      owner.kind === 'trade'
        ? await api.addTradeMedia({ tradeId: owner.tradeId, token: staged.token, timeframe, stage, caption })
        : await api.addDayMedia({ accountId: owner.accountId, date: owner.date, token: staged.token, timeframe, stage, caption })
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onAdded(result.data)
    onClose()
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.backdrop} role="dialog" aria-label={t('addChart')} onClick={onClose}>
      <div className={styles.panel} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {step !== 'source' && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setStep(step === 'details' ? 'source' : step === 'live' ? 'sources' : 'source')}
                aria-label={t('back')}
              >
                <ArrowLeft size={15} strokeWidth={1.75} />
              </button>
            )}
            <span className={styles.title}>{t('addChart')}</span>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('cancel')}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <canvas ref={captureCanvasRef} className={styles.hiddenCanvas} />

        {step === 'source' && (
          <div className={styles.sourceGrid}>
            <button type="button" className={styles.sourceButton} onClick={() => void handlePickFile()}>
              <Upload size={20} strokeWidth={1.5} />
              {t('uploadImage')}
            </button>
            <button type="button" className={styles.sourceButton} onClick={() => void handleOpenCapture()}>
              <Monitor size={20} strokeWidth={1.5} />
              {t('captureScreen')}
            </button>
          </div>
        )}

        {step === 'sources' && (
          <div className={styles.sourcesBody}>
            <div className={styles.hint}>{t('selectCaptureSource')}</div>
            {sources === null ? (
              <p className={styles.hint}>{t('choosingSource')}</p>
            ) : sources.length === 0 ? (
              <p className={styles.hint}>
                {t('noCaptureSources')} {t('capturePermissionHint')}
              </p>
            ) : (
              <div className={styles.sourceThumbGrid}>
                {sources.map((source) => (
                  <button key={source.id} type="button" className={styles.sourceThumb} onClick={() => void handlePickSource(source)}>
                    {source.thumbnailDataUrl !== '' && <img src={source.thumbnailDataUrl} alt="" />}
                    <span>{source.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'live' && frameDataUrl !== null && (
          <div className={styles.liveBody}>
            <div className={styles.hint}>{t('cropOptional')}</div>
            <div className={styles.cropArea} onMouseDown={startSelection} onMouseMove={updateSelection} onMouseUp={endSelection}>
              <img ref={previewImgRef} src={frameDataUrl} alt="" className={styles.capturePreview} />
              {selection && (
                <div
                  className={styles.selectionBox}
                  style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
                />
              )}
            </div>
            <div className={styles.liveActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => void finalizeFrame(false)}>
                {t('useFullCapture')}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={selection === null || selection.w < 5 || selection.h < 5}
                onClick={() => void finalizeFrame(true)}
              >
                {t('applyCrop')}
              </button>
            </div>
          </div>
        )}

        {step === 'details' && staged !== null && (
          <div className={styles.detailsBody}>
            <img src={staged.previewDataUrl} alt="" className={styles.detailsPreview} />
            <div className={styles.field}>
              <label className={styles.label} htmlFor="chart-timeframe">
                {t('timeframe')}
              </label>
              <select
                id="chart-timeframe"
                className={styles.select}
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value as MediaTimeframeDto)}
              >
                {MEDIA_TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {timeframeLabel(tf) || t('timeframe.other')}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="chart-stage">
                {t('stage')}
              </label>
              <select
                id="chart-stage"
                className={styles.select}
                value={stage}
                onChange={(event) => setStage(event.target.value as MediaStageDto)}
              >
                {MEDIA_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(stageI18nKey(s))}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="chart-caption">
                {t('caption')}
              </label>
              <input
                id="chart-caption"
                type="text"
                className={styles.input}
                value={caption}
                placeholder={t('captionPlaceholder')}
                maxLength={500}
                onChange={(event) => setCaption(event.target.value)}
              />
            </div>
            <div className={styles.detailsActions}>
              <button type="button" className={styles.secondaryButton} onClick={onClose}>
                {t('cancel')}
              </button>
              <button type="button" className={styles.primaryButton} disabled={saving} onClick={() => void handleSave()}>
                {saving ? t('savingChart') : t('save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
