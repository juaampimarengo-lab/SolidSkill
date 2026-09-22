# Solid Skill — IPC Contract

Checkpoints 011B-1 (Strategies) and 011B-2 (Trading). How the renderer reaches persisted data. Persistence
itself is described in `PERSISTENCE.md` and `DATABASE_SCHEMA.md`.

```
Renderer ─▶ window.solidSkill (preload) ─▶ typed IPC ─▶ handlers (validate)
        ─▶ StrategyService / TradingService ─▶ repositories ─▶ SQLite   (all in main)
```

## 1. Renderer trust boundary

The renderer is untrusted UI code. It never imports `node:sqlite`, the
database module, repository classes, SQL, or `ipcMain`, and it has no
`require`, `process`, or raw `ipcRenderer` (verified at runtime by
`npm run qa:strategies-restart`). Everything it sends is treated as
`unknown` until validated in the main process. Anything it receives is plain
application data.

## 2. Preload role

`src/preload/index.ts` is the only bridge. Through `contextBridge` it exposes
exactly one object, `window.solidSkill`, whose methods each invoke one fixed
channel. It exposes no generic `send`/`invoke`, no channel names, no
filesystem, no process, no SQL. The type of the object is
`SolidSkillApi` in `src/shared/ipc/api.ts` (namespaces `strategies`,
`trades` and `accounts`), declared globally in `src/preload/index.d.ts`.

## 3. Strategy operations

All return `Promise<IpcResult<…>>`. Mutations return the resulting Strategy
aggregate so the renderer reconciles with what was actually persisted.

| Method | Effect |
|---|---|
| `list()` | every strategy (active + archived) with published versions (oldest first) and its optional Draft |
| `create({name, description})` | Strategy + initial empty Draft in one transaction; **no version** until first publish |
| `updateDetails({strategyId, name, description})` | metadata only; never creates a Draft or Version |
| `archive(id)` / `restore(id)` | lifecycle flag; history untouched. Archive requires ≥1 published version and no open Draft; idempotent |
| `deleteUnpublished(id)` | permanent delete, only for a never-published strategy |
| `beginDraft(id)` | Draft copied from the current published version (one Draft per strategy) |
| `discardDraft(id)` | removes only the Draft; requires a published version to return to |
| `editDraft({strategyId, edit})` | one intent-level edit: `addGroup`, `renameGroup`, `deleteGroup`, `moveGroup`, `addRule`, `updateRule`, `deleteRule`, `moveRule` |
| `publishDraft(id)` | validates, then makes the next sequential immutable version, in one transaction |

Rules enforced in main regardless of what the UI does: archived strategies are
read-only; group/rule ids are honoured only if they belong to *this*
strategy's Draft; names are unique case-insensitively; publish requires ≥1
rule, no empty/unnamed groups, and a change from the base version (the same
shared function the UI uses: `src/shared/strategyRules.ts`). Published
versions stay immutable at the repository *and* schema level.

## 3b. Trading operations (011B-2)

DTOs and channel names: `src/shared/ipc/trades.ts`. Handlers and validation:
`src/main/ipc/tradeHandlers.ts` + `validation.ts`; logic:
`src/main/trading/tradingService.ts`. Exactly six channels; nothing generic.

| Method | Effect |
|---|---|
| `list({accountId?, fromDate?, toDate?})` | accounts + a `TradeSummaryDto` per trade (chronological by analytical date, then open time) + the (account, date) pairs that have a Day Note. No executions or rule rows. |
| `getDetail(tradeId)` | trade summary + executions + the exact saved strategy version with the trade's rule results (grouped as that version defined them) + trade note + day note + same-day sibling summaries |
| `getDay({accountId, date})` | (account, analytical date) → trades + day note |
| `updateTradeNote({tradeId, body})` | plain-text upsert (≤ 20 000 chars) |
| `updateDayNote({accountId, date, body})` | plain-text upsert for (account, date) |
| `updateRuleEvaluation({tradeId, ruleId, state})` | `Pass` / `Fail` / `N/A` / `Unreviewed` for one rule of **the trade's own strategy version**; any other rule → `RULE_VIOLATION`. Returns the new rule-state counts. |

Model rules:

- money, price, quantity and R are **decimal strings** (`null` = not reported,
  never zero); timestamps are epoch ms; the **analytical date** (`YYYY-MM-DD`,
  validated as a real calendar date) is the day-grouping key;
- direction is the persisted `Long` / `Short`, never derived from executions;
- strategy association is `{strategyId, versionId, versionNumber}` plus the
  strategy's *current* display name;
- compliance is derived from the four rule-state counts by
  `src/shared/compliance.ts` (PASS / (PASS + FAIL); N/A and UNREVIEWED excluded;
  UNREVIEWED ⇒ Incomplete) — there are no categorical compliance states;
- trades and executions are not writable through IPC; nothing touches a broker;
- an unavailable database yields `PERSISTENCE_UNAVAILABLE` on every channel;
- list-vs-detail split: summaries carry counts only, detail is requested per
  opened trade, so the UI never issues a call per row or per execution.

## 3c. Accounts operations (012B-3)

DTOs and channels: `src/shared/ipc/accounts.ts`; handlers
`src/main/ipc/accountHandlers.ts`; logic `src/main/accounts/accountService.ts`.
Exactly two channels. Details in `ACTIVE_ACCOUNT.md`.

| Method | Effect |
|---|---|
| `list()` | selectable accounts `{id, displayName, currency, timezone}` + the resolved `activeAccountId` (remembered choice, else first account, else null) |
| `setActive(accountId)` | validates the id (`NOT_FOUND` otherwise), remembers it in a local preference file, returns the same shape. Writes no trading data. |

No source login, server, credentials or broker metadata cross this surface.

## 4. Error / result shape

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code; message } }
code: PERSISTENCE_UNAVAILABLE | INVALID_INPUT | NOT_FOUND | CONFLICT | RULE_VIOLATION | INTERNAL
```

The renderer never receives a thrown exception. `PERSISTENCE_UNAVAILABLE`
means the database failed to open at startup: the UI shows an error state,
**never** fixtures or an empty list. `INTERNAL` carries a generic message;
details are logged in main only.

## 5. Serialization rules

- Only JSON-serializable values cross: strings, numbers, booleans, null,
  arrays, plain objects. No `BigInt`, `Date`, class instances, functions, or
  `Map`/`Set`.
- Timestamps are epoch milliseconds (`publishedAt`); formatting is the
  renderer's job.
- Persistence rows (upper-case enums, fixed-point integers) never cross.
  Handlers return DTOs (`StrategyDto`, `TradeSummaryDto` …).
  Money/price/quantity/R cross as decimal strings, never `BigInt` or floats (see
  `DATABASE_SCHEMA.md` §13); the renderer aggregates them exactly and converts
  to a number only for display.
- IDs are opaque strings. Persisted IDs — not names — identify strategies,
  versions, groups, rules, accounts and trades.
- Payloads are validated with bounds (`src/main/ipc/validation.ts`); unknown
  edit types, wrong types, oversized text → `INVALID_INPUT`.

## 6. Why raw SQL / DB access is prohibited

A `query(sql)` or exposed connection would let any renderer bug (or injected
content) rewrite or delete history, bypass the immutability rules
(`CLAUDE.md` Absolute Rule 3), and would couple UI code to the schema so every
migration becomes a UI change. Application-level operations keep every
invariant in one place (service + schema triggers), keep the UI independent of
storage, and keep the trust boundary auditable: the entire renderer-reachable
surface is the table in §3.

## 7. Future extension (Accounts, integrations)

`trades` (011B-2) and the minimal `accounts` (012B-3) follow this pattern. Add further namespaces to
`SolidSkillApi` with their own DTOs, channel constants,
validators, and service, the same way:
shared DTO + channel names in `src/shared/ipc/`, validation + handlers in
`src/main/ipc/`, a service over the repositories, one line per method in the
preload. Trade DTOs carry money as decimal strings and associate strategies
by persisted Strategy/Version ids. Nothing is generic; every operation is
named and reviewed.

## MT5 bridge is not part of this contract

The MT5 read-only raw-deal bridge (Checkpoint 012, `MT5_INTEGRATION_SPIKE.md`)
lives entirely in the main process and adds **no** renderer IPC channel and
nothing to `window.solidSkill`. Raw MT5 deals are never sent to renderer
state. No IPC operation anywhere may place, modify, cancel, or close orders.

## 8. Trading data-changed push (Checkpoint 012B-4)

One exception to "every operation is a request/response call" (§3b): after
automatic MT5 reconciliation (`MT5_RECONCILIATION.md`) persists new Trades,
main pushes a `trades:dataChanged` message to every renderer window carrying
exactly `{ accountId: string; reason: 'mt5-reconciliation' }` — never MT5
login, server, deal tickets, or any other raw source identity.
`TradesApi.onDataChanged(listener)` subscribes and returns an unsubscribe
function. Unlike every other Trading operation, this is **not**
`ipcMain.handle`d and is deliberately not one of `TRADE_CHANNELS` (see
`TRADE_DATA_CHANGED_CHANNEL` in `src/shared/ipc/trades.ts`); it is a
one-directional main → renderer notification, not a call the renderer
invokes. `useTrading` is the only current subscriber and performs a silent
re-read of `trades.list()` on receipt.
