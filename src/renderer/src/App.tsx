import { useState, type JSX } from 'react'
import { AppShell } from '@renderer/components/shell/AppShell'
import type { Representation } from '@renderer/components/shell/Topbar'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { CalendarWorkspace } from '@renderer/components/calendar/CalendarWorkspace'
import { JournalWorkspace } from '@renderer/components/journal/JournalWorkspace'
import { DayReviewWorkspace } from '@renderer/components/dayreview/DayReviewWorkspace'
import { TradeReviewWorkspace } from '@renderer/components/tradereview/TradeReviewWorkspace'
import { StrategiesWorkspace } from '@renderer/components/strategies/StrategiesWorkspace'
import { Placeholder } from '@renderer/components/shell/Placeholder'
import type { NavEntry } from '@renderer/types/navigation'
import { journalTrades } from '@renderer/data/journalDummyData'
import { StrategiesStatus } from '@renderer/components/strategies/StrategiesStatus'
import { useStrategies } from '@renderer/hooks/useStrategies'

function App(): JSX.Element {
  const [active, setActive] = useState('Dashboard')
  // UI state only — no conversion logic. Lives here (not in Topbar) so it
  // survives navigation and can later drive real value recalculation once
  // the Strategy/Trading Domain layers exist to back it.
  const [representation, setRepresentation] = useState<Representation>('$')

  // Strategies are persisted in SQLite (main process) and reached only through
  // the typed preload API. Loaded once here so the workspace keeps its state
  // across sidebar navigation. There is no fixture fallback: a persistence
  // failure is shown as an error, never as empty or fake data.
  const strategyData = useStrategies()

  // Day Review / Trade Review are contextual overlays stacked on top of
  // whichever sidebar section is active, not permanent sidebar destinations
  // (see CLAUDE.md checkpoint instructions, "NAVIGATION ARCHITECTURE"). The
  // underlying section stays mounted underneath (toggled via CSS, not
  // unmounted) so state like Journal's filters survives Back navigation.
  const [navStack, setNavStack] = useState<NavEntry[]>([])
  const overlay = navStack[navStack.length - 1] ?? null

  // The sidebar highlight always stays on the originating section (`active`),
  // but the topbar title should reflect whatever contextual overlay is on
  // top of it — see CLAUDE.md checkpoint instructions, "GOAL 1 — CONTEXTUAL
  // PAGE TITLE."
  const pageTitle =
    overlay?.kind === 'dayReview' ? 'Day Review' : overlay?.kind === 'tradeReview' ? 'Trade Review' : active

  function selectSection(label: string): void {
    setActive(label)
    setNavStack([])
  }

  function openDayReview(date: string): void {
    setNavStack((stack) => [...stack, { kind: 'dayReview', date }])
  }

  function openTradeReview(tradeId: string, date: string): void {
    setNavStack((stack) => [...stack, { kind: 'tradeReview', tradeId, date }])
  }

  // Switching among a day's sibling trades updates the current overlay in
  // place — it does not push a new Back destination.
  function switchTradeReview(tradeId: string): void {
    setNavStack((stack) => {
      const top = stack[stack.length - 1]
      if (!top || top.kind !== 'tradeReview') return stack
      return [...stack.slice(0, -1), { kind: 'tradeReview', tradeId, date: top.date }]
    })
  }

  function goBack(): void {
    setNavStack((stack) => stack.slice(0, -1))
  }

  function openTradeReviewFromAnywhere(tradeId: string): void {
    // Dashboard/Journal entry points don't have a day-review origin — the
    // trade's own date is only needed for the sibling-trade context panel.
    const date = findTradeDate(tradeId)
    if (date) openTradeReview(tradeId, date)
  }

  return (
    <AppShell
      active={active}
      pageTitle={pageTitle}
      onSelect={selectSection}
      representation={representation}
      onChangeRepresentation={setRepresentation}
    >
      <div style={{ display: overlay ? 'none' : 'block', height: '100%' }}>
        {active === 'Dashboard' && (
          <Dashboard onOpenTradeReview={openTradeReviewFromAnywhere} onOpenDayReview={openDayReview} />
        )}
        {active === 'Calendar' && <CalendarWorkspace onOpenDayReview={openDayReview} />}
        {active === 'Journal' && <JournalWorkspace onOpenTradeReview={openTradeReviewFromAnywhere} />}
        {active === 'Strategies' &&
          (strategyData.state.status === 'ready' ? (
            <StrategiesWorkspace
              strategies={strategyData.state.strategies}
              actions={strategyData.actions}
              actionError={strategyData.actionError}
              onDismissError={strategyData.dismissActionError}
              onOpenTradeReview={openTradeReviewFromAnywhere}
            />
          ) : (
            <StrategiesStatus state={strategyData.state} onRetry={strategyData.reload} />
          ))}
        {active !== 'Dashboard' &&
          active !== 'Calendar' &&
          active !== 'Journal' &&
          active !== 'Strategies' && <Placeholder />}
      </div>

      {overlay && overlay.kind === 'dayReview' && (
        <DayReviewWorkspace
          date={overlay.date}
          onBack={goBack}
          onOpenTrade={(tradeId) => openTradeReview(tradeId, overlay.date)}
        />
      )}

      {overlay && overlay.kind === 'tradeReview' && (
        <TradeReviewWorkspace tradeId={overlay.tradeId} onBack={goBack} onSwitchTrade={switchTradeReview} />
      )}
    </AppShell>
  )
}

function findTradeDate(tradeId: string): string | null {
  return journalTrades.find((t) => t.id === tradeId)?.date ?? null
}

export default App
