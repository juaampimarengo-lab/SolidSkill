# Solid Skill — Active Account

Checkpoint 012B-3. The minimal mechanism that lets the user choose which
persisted trading account the trading screens show. It is **not** the future
Accounts product.

## Concept and identity

There is exactly one *active account* for trading-data screens. It is identified
by the persisted **Solid Skill account UUID** (`accounts.id`) — never by display
name, list index, or source login. The selector shows display names
(`Demo Account 50K`, `MT5 · ***514`); everything it stores and sends is the id.

## Selector scope

A compact control in the Topbar (`AccountSelector`) replaces the old static
account text: name + currency + chevron, a dense listbox of selectable accounts
with a check on the active one, Escape / outside-click to close, ellipsis for
long names. States: loading (restrained, disabled), no accounts (disabled),
error (disabled "Accounts unavailable", never demo data). No create / edit /
delete / settings / broker connection / balances.

## Persistence and fallback

The choice is an app preference, not trading data: `preferences.json` in the
Electron userData folder (`{"activeAccountId": "<uuid>"}`, atomic write),
owned by the main process (`src/main/accounts`). No trading table and no
migration are involved (a migration would add nothing: the value is per-install
UI state, not a domain fact).

Resolution in main (`AccountService.list`), deterministic:

1. remembered id, if it still names a selectable (non-archived) account;
2. otherwise the first selectable account (oldest first);
3. otherwise `null` — trading screens render their normal empty state.

A missing / malformed / unreadable preference file reads as "no preference".
The fallback is not written back; only an explicit user choice writes the file.

## IPC

`window.solidSkill.accounts` — `list()` and `setActive(accountId)`, both
returning `{ accounts: AccountDto[], activeAccountId: string | null }`.
`AccountDto` = `{ id, displayName, currency, timezone }`. See
`IPC_CONTRACT.md`. `setActive` validates the id in main (`NOT_FOUND` for an
unknown/archived account) and touches only the preference file.

## Privacy boundary

Not exposed to the renderer: MT5 login / source account id, server, credentials,
raw broker metadata. The `MT5 · ***514` label is a display name produced at
import time. Only the Solid Skill UUID appears in navigation state (never in a
URL, and never a source identity).

## Screens

| Screen | Behaviour |
|---|---|
| Journal | only the active account's trades; filters/selection reset on switch (keyed by account id) |
| Calendar | groups the active account's trades by analytical trade date (policy unchanged); month/selection reset on switch |
| Day Review | opened with `(activeAccountId, analyticalDate)` captured at open time |
| Trade Review | still resolves by globally unique Trade id; opening a trade never changes the active account |
| Dashboard | consumes the same account-scoped trades (recent trades, calendar preview, metrics) |
| Strategies → Trades | **deliberately global.** Strategy/version associations are cross-account history (`allTrades`); filtering by the active account would hide evaluations of the same strategy version made on another account. |

Switching accounts closes any open Day/Trade Review (it belongs to the
previous account) and returns to the section; Back-navigation therefore never
crosses accounts. The switch also silently re-reads the Trade list.

## Race safety

Scoping is a pure, synchronous filter of the fetched Trade list by the active id
(`lib/tradingScope.ts`), so an account A response can never be rendered under
account B. Persisting a selection uses a latest-wins gate (`lib/latest.ts`):
only the newest choice may reconcile state. Day/Trade queries key on their
ids and already drop superseded responses.

## Demo + real coexistence, safety

The dev database keeps `Demo Account 50K` and the imported `MT5 · ***514`
side by side; nothing merges, deletes, or reassigns them. Selecting an account
is read-only for Trade facts (tested by table digests before/after switching).
Selection never triggers an MT5 import: synchronization remains the separate,
explicit development gate. Nothing here touches a broker.

## Testing

- `npm run smoke:persistence` — accounts list, DTO privacy, UUID identity,
  scoping (Journal/Calendar/Day/Trade), zero-account / zero-trade, restart
  persistence, missing/malformed/archived fallbacks, handler validation,
  latest-wins gate, no writes to trade facts.
- `npm run qa:active-account` — drives the built app against a *copy* of the
  `solid-skill-dev` database (never the real file): selector, demo↔MT5, Day/Trade
  Review, rapid switching, restart persistence (`QA_SHOTS=<dir>` for screenshots).

## Still to come (future Accounts product)

Accounts page, creating/renaming/archiving accounts, broker connection
management, prop-firm configuration, account grouping, balances/equity, per-account
timezone editing, consolidated "all accounts" views, and (if ever needed) a
better first-run default than "oldest account".
