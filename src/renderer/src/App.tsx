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
import { SettingsWorkspace } from '@renderer/components/settings/SettingsWorkspace'
import type { NavEntry } from '@renderer/types/navigation'
import { StrategiesStatus } from '@renderer/components/strategies/StrategiesStatus'
import { DataStatus } from '@renderer/components/shared/DataStatus'
import { useStrategies } from '@renderer/hooks/useStrategies'
import { useAccounts } from '@renderer/hooks/useAccounts'
import { useLanguage } from '@renderer/hooks/useLanguage'
import { useTrading, type TradingData } from '@renderer/hooks/useTrading'

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

  // Trades (with their accounts) are persisted in SQLite too and loaded once
  // here as the single Trade universe every summary surface shares — Dashboard,
  // Calendar, Journal, Strategies → Trades. Day Review and Trade Review load
  // their own coherent detail views. Same rule: an error is an error, never
  // fixtures.
  //
  // The active account (chosen in the Topbar, docs/ACTIVE_ACCOUNT.md) scopes
  // Dashboard, Calendar, Journal and Day Review. Strategies stay global.
  const accounts = useAccounts()
  const language = useLanguage()
  const activeAccountId = accounts.state.status === 'ready' ? accounts.state.data.activeAccountId : null
  const trading = useTrading(activeAccountId)
  const strategiesState = strategyData.state

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
    // Silent re-read so a Strategy renamed elsewhere shows its new name here.
    trading.refresh()
  }

  // An open Day/Trade Review belongs to the previous account, so a switch
  // returns to the section itself. Trade Review by id never changes the account.
  function selectAccount(accountId: string): void {
    if (accountId === activeAccountId) return
    setNavStack([])
    accounts.select(accountId)
    trading.refresh()
  }

  function openDayReview(date: string): void {
    const accountId = trading.state.status === 'ready' ? trading.state.data.account?.id : undefined
    if (accountId === undefined) return
    setNavStack((stack) => [...stack, { kind: 'dayReview', accountId, date }])
  }

  function openTradeReview(tradeId: string): void {
    setNavStack((stack) => [...stack, { kind: 'tradeReview', tradeId }])
  }

  // Switching among a day's sibling trades updates the current overlay in
  // place — it does not push a new Back destination.
  function switchTradeReview(tradeId: string): void {
    setNavStack((stack) => {
      const top = stack[stack.length - 1]
      if (!top || top.kind !== 'tradeReview') return stack
      return [...stack.slice(0, -1), { kind: 'tradeReview', tradeId }]
    })
  }

  function goBack(): void {
    setNavStack((stack) => stack.slice(0, -1))
  }

  // Trading surfaces need the persisted Trade universe; show its loading/error
  // state instead of a screen when it isn't ready.
  function whenTradingReady(render: (data: TradingData) => JSX.Element, scoped = true): JSX.Element {
    if (scoped && accounts.state.status !== 'ready') {
      return <DataStatus what="Accounts" state={accounts.state} onRetry={accounts.retry} />
    }
    const state = trading.state
    if (state.status !== 'ready') return <DataStatus what="Trades" state={state} onRetry={trading.retry} />
    return render(state.data)
  }

  return (
    <AppShell
      active={active}
      pageTitle={pageTitle}
      onSelect={selectSection}
      accounts={{ ...accounts, select: selectAccount }}
      representation={representation}
      onChangeRepresentation={setRepresentation}
    >
      <div style={{ display: overlay ? 'none' : 'block', height: '100%' }}>
        {active === 'Dashboard' &&
          whenTradingReady((data) => (
            <Dashboard key={data.account?.id ?? 'none'} trading={data} onOpenTradeReview={openTradeReview} onOpenDayReview={openDayReview} />
          ))}
        {active === 'Calendar' &&
          whenTradingReady((data) => <CalendarWorkspace key={data.account?.id ?? 'none'} trading={data} onOpenDayReview={openDayReview} />)}
        {active === 'Journal' &&
          whenTradingReady((data) => <JournalWorkspace key={data.account?.id ?? 'none'} trading={data} onOpenTradeReview={openTradeReview} />)}
        {active === 'Strategies' &&
          (strategiesState.status !== 'ready' ? (
            <StrategiesStatus state={strategiesState} onRetry={strategyData.reload} />
          ) : (
            whenTradingReady((data) => (
              <StrategiesWorkspace
                strategies={strategiesState.strategies}
                trades={data.allTrades}
                actions={strategyData.actions}
                actionError={strategyData.actionError}
                onDismissError={strategyData.dismissActionError}
                onOpenTradeReview={openTradeReview}
              />
            ), false)
          ))}
        {active === 'Settings' && <SettingsWorkspace language={language} />}
        {active !== 'Dashboard' &&
          active !== 'Calendar' &&
          active !== 'Journal' &&
          active !== 'Strategies' &&
          active !== 'Settings' && <Placeholder />}
      </div>

      {overlay && overlay.kind === 'dayReview' && (
        <DayReviewWorkspace
          accountId={overlay.accountId}
          date={overlay.date}
          onBack={goBack}
          onOpenTrade={openTradeReview}
        />
      )}

      {overlay && overlay.kind === 'tradeReview' && (
        <TradeReviewWorkspace tradeId={overlay.tradeId} onBack={goBack} onSwitchTrade={switchTradeReview} />
      )}
    </AppShell>
  )
}

export default App
