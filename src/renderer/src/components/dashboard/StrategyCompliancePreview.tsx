import type { ComponentType, JSX } from 'react'
import { Check, X, Minus } from 'lucide-react'
import { complianceRules } from '@renderer/data/dummyData'
import styles from './StrategyCompliancePreview.module.css'

const stateIcon: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  Pass: Check,
  Fail: X,
  'N/A': Minus
}

const stateClass: Record<string, string> = {
  Pass: styles.statePass,
  Fail: styles.stateFail,
  'N/A': styles.stateNa
}

export function StrategyCompliancePreview(): JSX.Element {
  return (
    <section className={styles.widget}>
      <span className={styles.title}>Strategy Compliance — Preview</span>

      <div className={styles.list}>
        {complianceRules.map((rule) => {
          const Icon = stateIcon[rule.state]
          return (
            <div key={rule.name} className={styles.row}>
              <span className={styles.name}>{rule.name}</span>
              <span className={`${styles.state} ${stateClass[rule.state]}`}>
                <Icon size={12} strokeWidth={2} />
                {rule.state}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
