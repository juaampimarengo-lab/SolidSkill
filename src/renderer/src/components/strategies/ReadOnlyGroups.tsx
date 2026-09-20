import type { JSX } from 'react'
import type { RuleGroupDef } from '@renderer/types/strategy'
import styles from './Strategies.module.css'

// Read-only structure view, used for published (frozen) versions in both the
// Rules tab and Version History. No controls of any kind.
export function ReadOnlyGroups({ groups }: { groups: readonly RuleGroupDef[] }): JSX.Element {
  return (
    <div>
      {groups.map((group) => (
        <div key={group.id} className={styles.group}>
          <div className={styles.groupHead}>
            <span className={styles.groupName}>{group.name}</span>
            <span className={styles.groupCount}>
              {group.rules.length} {group.rules.length === 1 ? 'rule' : 'rules'}
            </span>
          </div>
          {group.rules.map((rule) => (
            <div key={rule.id} className={styles.ruleRow}>
              <span className={styles.ruleName}>{rule.name}</span>
              <span className={styles.ruleKind}>{rule.kind}</span>
              <span className={styles.ruleDesc}>{rule.description}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
