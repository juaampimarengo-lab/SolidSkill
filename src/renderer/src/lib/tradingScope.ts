import type { AccountDto, TradeListDto } from '@shared/ipc/trades'
import type { TradeSummary } from '@renderer/types/journal'

/** The single Trade universe every summary surface reads, scoped to the active account. */
export interface TradingData {
  accounts: AccountDto[]
  /** Every persisted trade, chronological. Strategy views filter this by stable strategy id. */
  allTrades: TradeSummary[]
  /**
   * The active account (chosen in the Topbar; docs/ACTIVE_ACCOUNT.md), or null
   * when there is none. Dashboard, Calendar, Journal and Day Review show only
   * this account's trades.
   */
  account: AccountDto | null
  trades: TradeSummary[]
  /** Analytical dates (of the active account) that have a Day Note. */
  noteDates: ReadonlySet<string>
}

/** Pure: scopes the persisted Trade universe to the active account id. */
export function toTradingData(list: TradeListDto, activeAccountId: string | null): TradingData {
  const account = list.accounts.find((a) => a.id === activeAccountId) ?? null
  return {
    accounts: list.accounts,
    allTrades: list.trades,
    account,
    trades: account === null ? [] : list.trades.filter((t) => t.accountId === account.id),
    noteDates: new Set(
      list.daysWithNotes.filter((d) => account !== null && d.accountId === account.id).map((d) => d.date)
    )
  }
}
