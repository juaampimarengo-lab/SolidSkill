import { useState, type JSX } from 'react'
import type { MediaItemDto } from '@shared/ipc/media'
import { useDayMedia } from '@renderer/hooks/useMedia'
import { ChartGallery } from './ChartGallery'
import { AddChartModal } from './AddChartModal'

/** Chart Evidence for one (account, analytical date) — Day Review's own charts, distinct from any single Trade's. */
export function DayCharts({ accountId, date }: { accountId: string; date: string }): JSX.Element {
  const { state, refresh, retry } = useDayMedia(accountId, date)
  const [adding, setAdding] = useState(false)

  async function handleDelete(mediaId: string): Promise<void> {
    const api = window.solidSkill?.media
    if (!api) return
    await api.delete(mediaId)
    refresh()
  }

  function handleAdded(_item: MediaItemDto): void {
    refresh()
  }

  return (
    <>
      <ChartGallery state={state} retry={retry} onAdd={() => setAdding(true)} onDelete={handleDelete} compact />
      {adding && (
        <AddChartModal owner={{ kind: 'day', accountId, date }} onClose={() => setAdding(false)} onAdded={handleAdded} />
      )}
    </>
  )
}
