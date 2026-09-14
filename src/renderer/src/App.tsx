import { useState, type JSX } from 'react'
import { AppShell } from '@renderer/components/shell/AppShell'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { Placeholder } from '@renderer/components/shell/Placeholder'

function App(): JSX.Element {
  const [active, setActive] = useState('Dashboard')

  return (
    <AppShell active={active} onSelect={setActive}>
      {active === 'Dashboard' ? <Dashboard /> : <Placeholder />}
    </AppShell>
  )
}

export default App
