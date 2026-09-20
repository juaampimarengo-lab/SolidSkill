import { useState, type JSX } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { ruleKinds, type RuleGroupDef, type RuleKind, type Strategy } from '@renderer/types/strategy'
import {
  addGroup,
  addRule,
  currentVersion,
  deleteGroup,
  deleteRule,
  moveGroup,
  moveRule,
  renameGroup,
  startDraft,
  updateRule,
  type RuleInput
} from '@renderer/lib/strategyDraft'
import { ReadOnlyGroups } from './ReadOnlyGroups'
import styles from './Strategies.module.css'

interface RulesTabProps {
  strategy: Strategy
  onChange: (fn: (s: Strategy) => Strategy) => void
}

interface EditTarget {
  groupId: string
  // null = adding a new rule to the group
  ruleId: string | null
}

export function RulesTab({ strategy, onChange }: RulesTabProps): JSX.Element {
  const draft = strategy.draft
  const published = currentVersion(strategy)

  if (!draft) {
    return published ? (
      <div>
        <div className={styles.captionRow}>
          <div className={styles.tabCaption}>
            Published <span className="num">v{published.number}</span> · read-only. Published versions are frozen —
            changes are made in a Draft.
          </div>
          {strategy.status === 'Active' && (
            <button type="button" className={styles.buttonPrimary} onClick={() => onChange(startDraft)}>
              Edit Rules
            </button>
          )}
        </div>
        <ReadOnlyGroups groups={published.groups} />
      </div>
    ) : (
      <div className={styles.empty}>No published version.</div>
    )
  }

  return <DraftEditor strategy={strategy} groups={draft.groups} onChange={onChange} />
}

function DraftEditor({
  strategy,
  groups,
  onChange
}: {
  strategy: Strategy
  groups: RuleGroupDef[]
  onChange: (fn: (s: Strategy) => Strategy) => void
}): JSX.Element {
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [addingGroup, setAddingGroup] = useState(false)

  return (
    <div>
      <div className={styles.tabCaption}>
        {strategy.draft?.basedOn != null ? (
          <>
            Editing unpublished changes based on <span className="num">v{strategy.draft.basedOn}</span>. Published{' '}
            <span className="num">v{strategy.draft.basedOn}</span> remains unchanged.
          </>
        ) : (
          <>Editing the first Draft — no version exists until it is published.</>
        )}{' '}
        <span className={styles.staticNote}>Applicability conditions — coming later</span>
      </div>

      {groups.length === 0 && !addingGroup && (
        <div className={styles.empty}>No groups yet. Add a group, then add rules to it.</div>
      )}

      {groups.map((group, gi) => (
        <div key={group.id} className={styles.group}>
          <div className={styles.groupHead}>
            {renamingId === group.id ? (
              <InlineNameForm
                initial={group.name}
                placeholder="Group name"
                submitLabel="Save"
                onSubmit={(name) => {
                  onChange((s) => renameGroup(s, group.id, name))
                  setRenamingId(null)
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <>
                <span className={styles.groupName}>{group.name}</span>
                <span className={styles.groupCount}>
                  {group.rules.length} {group.rules.length === 1 ? 'rule' : 'rules'}
                </span>
                <span className={styles.spacer} />
                <div className={styles.rowActions}>
                  <IconButton
                    label="Move group up"
                    disabled={gi === 0}
                    onClick={() => onChange((s) => moveGroup(s, group.id, -1))}
                  >
                    <ArrowUp size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    label="Move group down"
                    disabled={gi === groups.length - 1}
                    onClick={() => onChange((s) => moveGroup(s, group.id, 1))}
                  >
                    <ArrowDown size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label="Rename group" onClick={() => setRenamingId(group.id)}>
                    <Pencil size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label="Delete group" onClick={() => onChange((s) => deleteGroup(s, group.id))}>
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
                submitLabel="Save rule"
                onSubmit={(input) => {
                  onChange((s) => updateRule(s, group.id, rule.id, input))
                  setEditing(null)
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
                    label="Move rule up"
                    disabled={ri === 0}
                    onClick={() => onChange((s) => moveRule(s, group.id, rule.id, -1))}
                  >
                    <ArrowUp size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    label="Move rule down"
                    disabled={ri === group.rules.length - 1}
                    onClick={() => onChange((s) => moveRule(s, group.id, rule.id, 1))}
                  >
                    <ArrowDown size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label="Edit rule" onClick={() => setEditing({ groupId: group.id, ruleId: rule.id })}>
                    <Pencil size={13} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label="Delete rule" onClick={() => onChange((s) => deleteRule(s, group.id, rule.id))}>
                    <Trash2 size={13} strokeWidth={1.75} />
                  </IconButton>
                </div>
              </div>
            )
          )}

          {editing?.groupId === group.id && editing.ruleId === null ? (
            <RuleForm
              initial={{ name: '', kind: 'Required', description: '' }}
              submitLabel="Add rule"
              onSubmit={(input) => {
                onChange((s) => addRule(s, group.id, input))
                setEditing(null)
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
              Add rule
            </button>
          )}
        </div>
      ))}

      {addingGroup ? (
        <div className={styles.group}>
          <div className={styles.groupHead}>
            <InlineNameForm
              initial=""
              placeholder="Group name"
              submitLabel="Add group"
              onSubmit={(name) => {
                onChange((s) => addGroup(s, name))
                setAddingGroup(false)
              }}
              onCancel={() => setAddingGroup(false)}
            />
          </div>
        </div>
      ) : (
        <button type="button" className={styles.buttonSecondary} onClick={() => setAddingGroup(true)}>
          <Plus size={12} strokeWidth={1.75} />
          Add rule group
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
  onSubmit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
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
        Cancel
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
  onSubmit: (input: RuleInput) => void
  onCancel: () => void
}): JSX.Element {
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
          placeholder="Rule name"
          aria-label="Rule name"
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
        placeholder="Description"
        aria-label="Rule description"
        rows={2}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className={styles.formRow}>
        <button type="submit" className={styles.buttonPrimary} disabled={!valid}>
          {submitLabel}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
          Cancel
        </button>
        <span className={styles.spacer} />
        <span className={styles.staticNote}>Conditions — coming later</span>
      </div>
    </form>
  )
}
