import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useAutosave } from '@renderer/hooks/useAutosave'
import { SaveIndicator } from '@renderer/components/weeklyreview/WeeklySections'
import styles from './DayReviewWorkspace.module.css'

/**
 * The Day Note of one (account, analytical date), editable in Day Review
 * (Checkpoint 015). Deliberately still ONE plain-text note (docs/WEEKLY_REVIEW.md
 * §10): the placeholder suggests a light structure — plan, what happened, what
 * went well, what could improve — without splitting the persisted note into
 * fields. Saved through the existing trades.updateDayNote operation, exactly
 * as typed.
 */
export function DayNoteEditor({
  accountId,
  date,
  initialBody
}: {
  accountId: string
  date: string
  initialBody: string
}): JSX.Element {
  const { t } = useTranslation('review')
  const draft = useAutosave<'body'>({ body: initialBody }, async ({ body }) => {
    const api = window.solidSkill?.trades
    if (!api || body === undefined) return { ok: false, error: { code: 'INTERNAL', message: 'unavailable' } }
    return api.updateDayNote({ accountId, date, body })
  })
  return (
    <div className={styles.noteEditor}>
      <div className={styles.noteHead}>
        <div className={styles.noteTitle}>Day Notes</div>
        <SaveIndicator status={draft.status} onRetry={draft.flush} />
      </div>
      <textarea
        className={styles.noteTextarea}
        data-day-note
        value={draft.values.body}
        placeholder={t('dayNote.placeholder')}
        title={t('dayNote.hint')}
        rows={7}
        spellCheck
        onChange={(event) => draft.setField('body', event.target.value)}
        onBlur={draft.flush}
      />
    </div>
  )
}
