import type { JSX } from 'react'
import { ChevronDown } from 'lucide-react'
import type { JournalTrade } from '@renderer/types/journal'
import styles from './JournalFilters.module.css'

// Filter state is UI state only for this checkpoint. Instrument/direction/
// strategy/outcome/compliance drive trivial local filtering (a straight
// equality check against fixture fields); account and date range are
// visual-only, since the dummy fixtures span one account and a handful of
// dates — see docs/JOURNAL_SPEC.md §4. This is not a generalized filtering
// engine.
export interface JournalFilterState {
  instrument: string
  direction: string
  strategy: string
  outcome: string
  compliance: string
}

export const defaultJournalFilters: JournalFilterState = {
  instrument: 'All',
  direction: 'All',
  strategy: 'All',
  outcome: 'All',
  compliance: 'All'
}

interface JournalFiltersProps {
  trades: JournalTrade[]
  filters: JournalFilterState
  onChange: (filters: JournalFilterState) => void
}

export function JournalFilters({ trades, filters, onChange }: JournalFiltersProps): JSX.Element {
  const instruments = Array.from(new Set(trades.map((t) => t.instrument))).sort()
  const strategies = Array.from(new Set(trades.map((t) => t.strategy))).sort()

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
        <SelectField value="Apex 50K" disabled options={['Apex 50K']} onChange={() => {}} />
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
        label="Compliance"
        value={filters.compliance}
        options={['All', 'Compliant', 'Partial', 'Violation']}
        onChange={(v) => set('compliance', v)}
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
  options: string[]
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
  options: string[]
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
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <ChevronDown size={12} strokeWidth={1.75} />
    </span>
  )
}
