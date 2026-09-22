import { useState, type JSX } from 'react'
import type { MediaItemDto } from '@shared/ipc/media'
import { useTradeMedia } from '@renderer/hooks/useMedia'
import { ChartGallery } from './ChartGallery'
import { AddChartModal } from './AddChartModal'

/** Chart Evidence for one Trade — used by both the canonical Trade Review Charts tab and the Journal quick preview. */
export function TradeCharts({ tradeId }: { tradeId: string }): JSX.Element {
  const { state, refresh, retry } = useTradeMedia(tradeId)
  const [adding, setAdding] = useState(false)

  async function handleDelete(mediaId: string): Promise<void> {
    const api = window.solidSkill?.media
    if (!api) return
    await api.delete(mediaId)
    refresh()
  }

  async function handleSetFeatured(mediaId: string): Promise<void> {
    const api = window.solidSkill?.media
    if (!api) return
    await api.setFeaturedTradeMedia({ tradeId, mediaId })
    refresh()
  }

  function handleAdded(_item: MediaItemDto): void {
    refresh()
  }

  return (
    <>
      <ChartGallery
        state={state}
        retry={retry}
        onAdd={() => setAdding(true)}
        onDelete={handleDelete}
        onSetFeatured={handleSetFeatured}
      />
      {adding && <AddChartModal owner={{ kind: 'trade', tradeId }} onClose={() => setAdding(false)} onAdded={handleAdded} />}
    </>
  )
}
