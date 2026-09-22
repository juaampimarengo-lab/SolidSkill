import { useState, type JSX } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { ruleKinds, type RuleGroupDef, type RuleKind, type Strategy } from '@renderer/types/strategy'
import type { DraftEdit } from '@shared/ipc/strategies'
import type { StrategyActions } from '@renderer/hooks/useStrategies'
import { currentVersion } from '@renderer/lib/strategyDraft'
import { ReadOnlyGroups } from './ReadOnlyGroups'
import styles from './Strategies.module.css'

interface RulesTabProps {
  strategy: Strategy
  actions: StrategyActions
}

interface RuleInput {
  name: string
  kind: RuleKind
  description: string
}

interface EditTarget {
  groupId: string
  // null = adding a new rule to the group
  ruleId: string | null
}

export function RulesTab({ strategy, actions }: RulesTabProps): JSX.Element {
  const { t } = useTranslation('strategy')
  const draft = strategy.draft
  const published = currentVersion(strategy)

  if (!draft) {
    return published ? (
      <div>
        <div className={styles.captionRow}>
          <div className={styles.tabCaption}>
            <Trans
              i18nKey="readOnlyBanner"
              t={t}
              values={{ version: published.number }}
              components={[<span key="num" className="num" />]}
            />
          </div>
          {strategy.status === 'Active' && (
            <button type="button" className={styles.buttonPrimary} onClick={() => void actions.beginDraft(strategy.id)}>
              {t('actions.editRules')}
            </button>
          )}
        </div>
        <ReadOnlyGroups groups={published.groups} />
      </div>
    ) : (
      <div className={styles.empty}>{t('empty.noPublishedVersion')}</div>
    )
  }

  return <DraftEditor strategy={strategy} groups={draft.groups} actions={actions} />
}

function DraftEditor({
  strategy,
  groups,
  actions
}: {
  strategy: Strategy
  groups: RuleGroupDef[]
  actions: StrategyActions
}): JSX.Element {
  const { t } = useTranslation('strategy')
  const { t: tCommon } = useTranslation('common')
  const edit = (e: DraftEdit): Promise<boolean> => actions.editDraft(strategy.id, e)
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [addingGroup, setAddingGroup] = useState(false)

  return (
    <div>
      <div className={styles.tabCaption}>
        {strategy.draft?.basedOn != null ? (
          <Trans
            i18nKey="draft.basedOn"
            t={t}
            values={{ version: strategy.draft.basedOn }}
            components={[<span key="num" className="num" />]}
          />
        ) : (
          t('draft.firstDraft')
        )}{' '}
        <span className={styles.staticNote}>{t('comingLater.applicability')}</span>
      </div>

      {groups.length === 0 && !addingGroup && <div className={styles.empty}>{t('empty.noGroups')}</div>}

      {groups.map((group, gi) => (
        <div key={group.id} className={styles.group}>
          <div className={styles.groupHead}>
            {renamingId === group.id ? (
              <InlineNameForm
                initial={group.name}
                placeholder={t('groupNamePlaceholder')}
                submitLabel={tCommon('save')}
                onSubmit={async (name) => {
                  if (await edit({ type: 'renameGroup', groupId: group.id, name })) setRenamingId(null)
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <>
                <span className={styles.groupName}>{group.name}</span>
                <span className={styles.groupCount}>
                  {group.rules.length} {t('rule', { count: group.rules.length })}
                </span>
                <span className={styles.spacer} />
                <div className={styles.rowActions}>
                  <IconButton
                    label={t('actions.moveGroupUp')}
                    disabled={gi === 0}
                    onClick={() => void edit({ type: 'moveGroup', groupId: group.id, delta: -1 })}
                  >
                    <ArrowUp size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    label={t('actions.moveGroupDown')}
                    disabled={gi === groups.length - 1}
                    onClick={() => void edit({ type: 'moveGroup', groupId: group.id, delta: 1 })}
                  >
                    <ArrowDown size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label={t('actions.renameGroup')} onClick={() => setRenamingId(group.id)}>
                    <Pencil size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label={t('actions.deleteGroup')} onClick={() => void edit({ type: 'deleteGroup', groupId: group.id })}>
                    <Trash2 size={13} strokeWidth={1.75} />
                  </IconButton>
                </div>
              </>
            )}
          </div>

          {group.rules.map((rule, ri) =>
            editing?.groupId === group.id && editing.ruleId === rule.id ? (
              <RuleForm
                key={rule.id}
                initial={{ name: rule.name, kind: rule.kind, description: rule.description }}
                submitLabel={t('actions.saveRule')}
                onSubmit={async (input) => {
                  if (await edit({ type: 'updateRule', ruleId: rule.id, ...input })) setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div key={rule.id} className={styles.ruleRow}>
                <span className={styles.ruleName}>{rule.name}</span>
                <span className={styles.ruleKind}>{rule.kind}</span>
                <span className={styles.ruleDesc}>{rule.description}</span>
                <div className={styles.rowActions}>
                  <IconButton
                    label={t('actions.moveRuleUp')}
                    disabled={ri === 0}
                    onClick={() => void edit({ type: 'moveRule', ruleId: rule.id, delta: -1 })}
                  >
                    <ArrowUp size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    label={t('actions.moveRuleDown')}
                    disabled={ri === group.rules.length - 1}
                    onClick={() => void edit({ type: 'moveRule', ruleId: rule.id, delta: 1 })}
                  >
                    <ArrowDown size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label={t('actions.editRule')} onClick={() => setEditing({ groupId: group.id, ruleId: rule.id })}>
                    <Pencil size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label={t('actions.deleteRule')} onClick={() => void edit({ type: 'deleteRule', ruleId: rule.id })}>
                    <Trash2 size={13} strokeWidth={1.75} />
                  </IconButton>
                </div>
              </div>
            )
          )}

          {editing?.groupId === group.id && editing.ruleId === null ? (
            <RuleForm
              initial={{ name: '', kind: 'Required', description: '' }}
              submitLabel={t('actions.addRule')}
              onSubmit={async (input) => {
                if (await edit({ type: 'addRule', groupId: group.id, ...input })) setEditing(null)
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              type="button"
              className={styles.addRow}
              onClick={() => setEditing({ groupId: group.id, ruleId: null })}
            >
              <Plus size={12} strokeWidth={1.75} />
              {t('actions.addRule')}
            </button>
          )}
        </div>
      ))}

      {addingGroup ? (
        <div className={styles.group}>
          <div className={styles.groupHead}>
            <InlineNameForm
              initial=""
              placeholder={t('groupNamePlaceholder')}
              submitLabel={t('actions.addGroup')}
              onSubmit={async (name) => {
                if (await edit({ type: 'addGroup', name })) setAddingGroup(false)
              }}
              onCancel={() => setAddingGroup(false)}
            />
          </div>
        </div>
      ) : (
        <button type="button" className={styles.buttonSecondary} onClick={() => setAddingGroup(true)}>
          <Plus size={12} strokeWidth={1.75} />
          {t('actions.addRuleGroup')}
        </button>
      )}
    </div>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: JSX.Element
}): JSX.Element {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function InlineNameForm({
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial: string
  placeholder: string
  submitLabel: string
  onSubmit: (name: string) => void | Promise<void>
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation('common')
  const [name, setName] = useState(initial)
  const valid = name.trim() !== ''
  return (
    <form
      className={styles.inlineForm}
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSubmit(name.trim())
      }}
    >
      <input
        className={styles.input}
        value={name}
        placeholder={placeholder}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      />
      <button type="submit" className={styles.buttonPrimary} disabled={!valid}>
        {submitLabel}
      </button>
      <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
        {t('cancel')}
      </button>
    </form>
  )
}

function RuleForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial: RuleInput
  submitLabel: string
  onSubmit: (input: RuleInput) => void | Promise<void>
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation('strategy')
  const { t: tCommon } = useTranslation('common')
  const [name, setName] = useState(initial.name)
  const [kind, setKind] = useState<RuleKind>(initial.kind)
  const [description, setDescription] = useState(initial.description)
  const valid = name.trim() !== ''

  return (
    <form
      className={styles.ruleForm}
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSubmit({ name: name.trim(), kind, description: description.trim() })
      }}
    >
      <div className={styles.formRow}>
        <input
          className={styles.input}
          value={name}
          placeholder={t('ruleNamePlaceholder')}
          aria-label={t('ruleNamePlaceholder')}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={styles.select}
          value={kind}
          aria-label="Rule kind"
          onChange={(e) => setKind(e.target.value as RuleKind)}
        >
          {ruleKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className={styles.textarea}
        value={description}
        placeholder={t('ruleDescriptionPlaceholder')}
        aria-label={t('ruleDescriptionPlaceholder')}
        rows={2}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className={styles.formRow}>
        <button type="submit" className={styles.buttonPrimary} disabled={!valid}>
          {submitLabel}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
          {tCommon('cancel')}
        </button>
        <span className={styles.spacer} />
        <span className={styles.staticNote}>{t('comingLater.conditions')}</span>
      </div>
    </form>
  )
}
