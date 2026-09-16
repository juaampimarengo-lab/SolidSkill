import { useState, type JSX } from 'react'
import { AppShell } from '@renderer/components/shell/AppShell'
import type { Representation } from '@renderer/components/shell/Topbar'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { CalendarWorkspace } from '@renderer/components/calendar/CalendarWorkspace'
import { JournalWorkspace } from '@renderer/components/journal/JournalWorkspace'
import { Placeholder } from '@renderer/components/shell/Placeholder'

function App(): JSX.Element {
  const [active, setActive] = useState('Dashboard')
  // UI state only — no conversion logic. Lives here (not in Topbar) so it
  // survives navigation and can later drive real value recalculation once
  // the Strategy/Trading Domain layers exist to back it.
  const [representation, setRepresentation] = useState<Representation>('$')

  return (
    <AppShell
      active={active}
      onSelect={setActive}
      representation={representation}
      onChangeRepresentation={setRepresentation}
    >
      {active === 'Dashboard' && <Dashboard />}
      {active === 'Calendar' && <CalendarWorkspace />}
      {active === 'Journal' && <JournalWorkspace />}
      {active !== 'Dashboard' && active !== 'Calendar' && active !== 'Journal' && <Placeholder />}
    </AppShell>
  )
}

export default App
