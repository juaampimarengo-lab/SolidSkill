import type { JSX } from 'react'
import { ChevronDown } from 'lucide-react'
import type { TradeSummary } from '@renderer/types/journal'
import styles from './JournalFilters.module.css'

// Filter state is UI state only. Instrument/direction/strategy/outcome/review
// drive trivial local filtering over the persisted Trade list (strategy by
// stable id, shown by name); account and date range are visual-only until the
// Accounts UI and date-range control exist — see docs/JOURNAL_SPEC.md §4. This
// is not a generalized filtering engine.
export interface JournalFilterState {
  instrument: string
  direction: string
  strategy: string
  outcome: string
  review: string
}

export const defaultJournalFilters: JournalFilterState = {
  instrument: 'All',
  direction: 'All',
  strategy: 'All',
  outcome: 'All',
  review: 'All'
}

interface JournalFiltersProps {
  accountName: string
  trades: readonly TradeSummary[]
  filters: JournalFilterState
  onChange: (filters: JournalFilterState) => void
}

interface FilterOption {
  value: string
  label: string
}

export function JournalFilters({ accountName, trades, filters, onChange }: JournalFiltersProps): JSX.Element {
  const instruments = Array.from(new Set(trades.map((t) => t.instrument))).sort()
  const strategyNames = new Map<string, string>()
  for (const t of trades) if (t.strategy) strategyNames.set(t.strategy.strategyId, t.strategy.strategyName)
  const strategies: FilterOption[] = Array.from(strategyNames, ([value, label]) => ({ value, label })).sort((a, b) =>
    a.label.localeCompare(b.label)
  )

  const isDirty = Object.entries(filters).some(
    ([key, value]) => value !== defaultJournalFilters[key as keyof JournalFilterState]
  )

  function set<K extends keyof JournalFilterState>(key: K, value: string): void {
    onChange({ ...filters, [key]: value })
  }

  return (
    <div className={styles.bar}>
      <span className={styles.field}>
        <span className={styles.label}>Account</span>
        <SelectField value={accountName} disabled options={[accountName]} onChange={() => {}} />
      </span>

      <span className={`${styles.field} ${styles.dateRange}`}>
        <span className={styles.label}>Range</span>
        <SelectField value="All Time" disabled options={['All Time']} onChange={() => {}} />
      </span>

      <FilterField
        label="Instrument"
        value={filters.instrument}
        options={['All', ...instruments]}
        onChange={(v) => set('instrument', v)}
      />

      <FilterField
        label="Direction"
        value={filters.direction}
        options={['All', 'Long', 'Short']}
        onChange={(v) => set('direction', v)}
      />

      <FilterField
        label="Strategy"
        value={filters.strategy}
        options={['All', ...strategies]}
        onChange={(v) => set('strategy', v)}
      />

      <FilterField
        label="Outcome"
        value={filters.outcome}
        options={['All', 'Win', 'Loss', 'Break-even']}
        onChange={(v) => set('outcome', v)}
      />

      <FilterField
        label="Review"
        value={filters.review}
        options={['All', 'Complete', 'Incomplete']}
        onChange={(v) => set('review', v)}
      />

      <span className={styles.spacer} />

      {isDirty && (
        <button type="button" className={styles.reset} onClick={() => onChange(defaultJournalFilters)}>
          Reset
        </button>
      )}
    </div>
  )
}

function FilterField({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: (string | FilterOption)[]
  onChange: (value: string) => void
}): JSX.Element {
  const active = value !== 'All'
  return (
    <span className={active ? `${styles.field} ${styles.fieldActive}` : styles.field}>
      <span className={styles.label}>{label}</span>
      <SelectField value={value} options={options} onChange={onChange} />
    </span>
  )
}

function SelectField({
  value,
  options,
  onChange,
  disabled
}: {
  value: string
  options: (string | FilterOption)[]
  onChange: (value: string) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <select
        className={styles.select}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => {
          const { value: optionValue, label } = typeof opt === 'string' ? { value: opt, label: opt } : opt
          return (
            <option key={optionValue} value={optionValue}>
              {label}
            </option>
          )
        })}
      </select>
      <ChevronDown size={12} strokeWidth={1.75} />
    </span>
  )
}
